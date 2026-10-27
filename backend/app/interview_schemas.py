from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr, StringConstraints


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InterviewCreate(StrictModel):
    resume_id: StrictStr
    jd_text: StrictStr


class InterviewAnswer(StrictModel):
    question_id: StrictStr
    answer_text: StrictStr


ShortText = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=600)]
FocusText = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=80)]
QuestionText = Annotated[str, StringConstraints(strict=True, strip_whitespace=True, min_length=1, max_length=300)]


class Question(StrictModel):
    id: str
    text: ShortText
    focus: FocusText


class Feedback(StrictModel):
    strengths: list[ShortText] = Field(max_length=5)
    improvements: list[ShortText] = Field(max_length=5)
    reference_points: list[ShortText] = Field(max_length=5)


class InterviewSession(StrictModel):
    interview_id: str
    status: Literal["active"] = "active"
    round: Literal[1] = 1
    max_rounds: Literal[5] = 5
    question: Question


class InterviewAnswerResult(StrictModel):
    interview_id: str
    status: Literal["active", "completed"]
    round: int = Field(ge=1, le=5)
    max_rounds: Literal[5] = 5
    feedback: Feedback
    next_question: Question | None


# The model must supply verifiable grounding. These internal fields are not
# part of the frontend contract; public responses retain the agreed shape.
class QuestionDraft(StrictModel):
    text: QuestionText
    focus: FocusText
    evidence_refs: list[ShortText] = Field(min_length=1, max_length=3)


class Strength(StrictModel):
    text: ShortText
    answer_ref: ShortText


class FeedbackDraft(StrictModel):
    strengths: list[Strength] = Field(max_length=5)
    improvements: list[ShortText] = Field(max_length=5)
    reference_points: list[ShortText] = Field(min_length=1, max_length=5)


class FirstQuestionDraft(StrictModel):
    question: QuestionDraft


class AnswerDraft(StrictModel):
    feedback: FeedbackDraft
    next_question: QuestionDraft | None
