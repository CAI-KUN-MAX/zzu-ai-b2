"""Verify real embeddings using two authorized UTF-8 text files; never print inputs or keys."""
import argparse
import asyncio
import json
import getpass
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.job_embedding import DIMENSIONS, MODEL, EmbeddingError, similarities


async def verify(resume, jd):
    usage = []
    result = {"model": MODEL, "requested_dimensions": DIMENSIONS, "usage": usage}
    try:
        values = await similarities(resume, [{"jd_text": jd}], asyncio.Semaphore(1),
                                    usage=usage, batch_size=1)
        result.update(status="succeeded", dimensions_valid=True, vectors_valid=True,
                      similarity=values[0])
    except EmbeddingError as error:
        result.update(status="failed", error=str(error), dimensions_valid=None,
                      vectors_valid=None, similarity=None)
    print(json.dumps(result, ensure_ascii=False))
    return result["status"] == "succeeded"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("resume", type=Path)
    parser.add_argument("jd", type=Path)
    parser.add_argument("--pdf", action="store_true", help="Read resume as a PDF with a text layer")
    parser.add_argument("--job-id", help="Read a job's JD from a catalogue JSON file")
    parser.add_argument("--prompt-key", action="store_true", help="Read API key without echoing it")
    args = parser.parse_args()
    if args.pdf:
        import pymupdf
        with pymupdf.open(args.resume) as document:
            resume = "\n".join(page.get_text() for page in document).strip()
    else:
        resume = args.resume.read_text(encoding="utf-8").strip()
    if args.job_id:
        catalogue = json.loads(args.jd.read_text(encoding="utf-8"))
        job = next((item for item in catalogue["items"] if item["job_id"] == args.job_id), None)
        if job is None:
            raise SystemExit("Job ID not found in catalogue.")
        jd = job["jd_text"].strip()
    else:
        jd = args.jd.read_text(encoding="utf-8").strip()
    if not resume or not jd:
        raise SystemExit("Both text files must be nonempty.")
    if args.prompt_key:
        os.environ["ZHIPUAI_API_KEY"] = getpass.getpass("Zhipu API key: ")
    raise SystemExit(0 if asyncio.run(verify(resume, jd)) else 1)


if __name__ == "__main__":
    main()
