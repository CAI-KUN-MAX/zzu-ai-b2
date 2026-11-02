"""Safety checks for the independent, read-only NCSS entry inspector."""
import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location(
    "ncss_entry_check", Path(__file__).resolve().parents[1] / "scripts" / "ncss_entry_check.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class EntryInspectorTests(unittest.TestCase):
    def test_hidden_inputs_and_elements_are_not_emitted(self):
        page = module.Page()
        page.feed('<html><head><title>招聘</title></head><body>'
                  '<input type="hidden" value="secret-value">'
                  '<div style="display:none">secret-body</div>'
                  '<script>secret-script</script><a href="#">投递简历</a>'
                  '</body></html>')
        self.assertNotIn("secret", str(page.text) + str(page.controls))
        self.assertEqual(page.controls[0]["text"], "投递简历")

    def test_url_redacts_query_fragment_and_rejects_userinfo(self):
        self.assertEqual(module.safe_url("https://example.org/app?token=secret#fragment"),
                         "https://example.org/app")
        self.assertIsNone(module.safe_url("https://user:secret@example.org/app"))
        self.assertIsNone(module.safe_url("http://example.org/app"))

    def test_redirect_to_another_host_is_rejected(self):
        handler = module.RestrictedRedirect("example.org")
        with self.assertRaises(ValueError):
            handler.redirect_request(None, None, 302, "Found", {}, "https://other.example/path")
        self.assertEqual(handler.chain, [])


if __name__ == "__main__":
    unittest.main()
