"""Optional LLM wording variation for caller lines, with strict validators and a silent fallback.

The client only sends (scenario_id, node_id, lang). The original line always comes from the
server's own copy of scenarios.<lang>.json. If rephrasing is disabled, slow, fails, or produces
anything that does not pass every validator, the original line is returned.
"""
from __future__ import annotations

import asyncio
import logging
import re
import unicodedata
from typing import Awaitable, Callable

from .config import Settings

log = logging.getLogger("scam_gym.rephrase")

TIMEOUT_SECONDS = 2.0
MIN_LENGTH_RATIO = 0.6
MAX_LENGTH_RATIO = 1.2  # keep length within +20 percent

# Real banks, fintechs, telecoms, card schemes, apps and agencies. Matched as whole words.
BLOCKED_TERMS = [
    "Access Bank", "Zenith", "GTBank", "GTCO", "Guaranty Trust", "First Bank", "FirstBank", "UBA",
    "United Bank for Africa", "Fidelity", "Union Bank", "Stanbic", "Sterling", "Wema", "Ecobank",
    "FCMB", "Polaris", "Keystone", "Heritage Bank", "Unity Bank", "Jaiz", "Providus", "Opay",
    "Moniepoint", "Palmpay", "Kuda", "FairMoney", "Paga", "Paystack", "Flutterwave", "Interswitch",
    "Quickteller", "Remita", "Visa", "Mastercard", "Verve", "MTN", "Glo", "Globacom", "Airtel",
    "9mobile", "Etisalat", "WhatsApp", "Facebook", "Instagram", "Telegram", "Google", "Apple",
    # Spanish- and French-speaking markets.
    "Santander", "BBVA", "CaixaBank", "Sabadell", "Bancolombia", "Banorte", "Movistar", "Telcel",
    "BNP", "Societe Generale", "Credit Agricole", "Credit Mutuel", "La Banque Postale", "Orange",
    "SFR", "Bouygues", "Lydia", "Bizum",
]
# Real agency names are allowed only if the original line already contains them.
AGENCY_TERMS = [
    "EFCC", "ICPC", "DSS", "NDLEA", "NCC", "FIRS", "CBN", "Central Bank", "NIBSS", "Police",
    "Interpol", "FBI", "Customs", "Immigration",
]
AGENCY_TERMS += ["Guardia Civil", "Policia", "Gendarmerie", "Policia Nacional", "Hacienda", "Impots"]
# Requests for real information, per language. Allowed only if the original line already asks for it.
SENSITIVE_REQUESTS = {
    "en": [
        "pin", "password", "otp", "one-time", "cvv", "card number", "account number", "bvn", "nin",
        "date of birth", "code", "token", "mother's maiden", "maiden name", "address", "login",
        "username", "security question", "expiry", "screenshot", "selfie", "id card",
    ],
    "es": [
        "pin", "contrasena", "clave", "otp", "cvv", "numero de tarjeta", "numero de cuenta",
        "fecha de nacimiento", "codigo", "token", "direccion", "usuario", "pregunta de seguridad",
        "caducidad", "vencimiento", "captura", "selfie", "dni", "documento de identidad",
    ],
    "fr": [
        "pin", "mot de passe", "otp", "cvv", "numero de carte", "numero de compte",
        "date de naissance", "code", "token", "adresse", "identifiant", "question secrete",
        "date d'expiration", "capture", "selfie", "carte d'identite",
    ],
}
LANG_NAMES = {"en": "English", "es": "Spanish", "fr": "French"}
# A non-English rephrase must not drift into English (Addendum A, Section 8).
ENGLISH_STOP_WORDS = ("the", "and", "you", "your", "is")
MAX_ENGLISH_STOP_WORDS = 3

URL_RE = re.compile(r"(https?://|www\.|\b[\w-]+\.(com|ng|org|net|io|co|gov|info|biz|xyz|link|app)\b)", re.I)
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(\+\d{6,}|\+?\d[\d\s().-]{8,}\d)")
NUMBER_RE = re.compile(r"\d[\d,]*")
ABBREVIATIONS = re.compile(r"\b(Mr|Mrs|Ms|Dr|Prof|St|Sr|Sra|Srta|M|Mme|Mlle)\.")


def fold(text: str) -> str:
    """Lowercase and strip diacritics, so "código" and "codigo" compare equal."""
    text = unicodedata.normalize("NFD", text.lower())
    return "".join(ch for ch in text if unicodedata.category(ch) != "Mn").replace("’", "'")


def _word_re(term: str) -> re.Pattern[str]:
    return re.compile(r"(?<![\w])" + re.escape(fold(term)) + r"(?![\w])", re.I)


def _has(term: str, text: str) -> bool:
    return bool(_word_re(term).search(fold(text)))


def numbers(text: str) -> set[str]:
    return {n.replace(",", "").rstrip(",") for n in NUMBER_RE.findall(text)}


def proper_nouns(text: str) -> set[str]:
    """Capitalized words that do not start a sentence (names, the fake bank, acronyms)."""
    cleaned = ABBREVIATIONS.sub(r"\1", text)
    found: set[str] = set()
    for sentence in re.split(r"(?<=[.!?])\s+", cleaned):
        words = re.findall(r"[^\W\d_][\w'’-]*", sentence)
        for w in words[1:]:
            if w[0].isupper() and w != "I" and not w.startswith("I'"):
                found.add(w)
    return found


def validate(original: str, candidate: str, lang: str = "en", english: str | None = None) -> tuple[bool, str]:
    """Return (ok, reason). All checks must pass."""
    text = candidate.strip()
    if not text:
        return False, "empty"
    if "\n" in text:
        return False, "multiple lines"
    if lang != "en":
        if english is not None and fold(text).strip() == fold(english).strip():
            return False, "language check: identical to the English line"
        words = re.findall(r"[^\W\d_]+", text.lower())
        if sum(w in ENGLISH_STOP_WORDS for w in words) > MAX_ENGLISH_STOP_WORDS:
            return False, "language check: too many English words"
    ratio = len(text) / max(1, len(original))
    if ratio < MIN_LENGTH_RATIO or ratio > MAX_LENGTH_RATIO:
        return False, "length out of bounds"
    if EMAIL_RE.search(text):
        return False, "contains an email"
    if URL_RE.search(text):
        return False, "contains a URL"
    if PHONE_RE.search(text):
        return False, "contains a phone number"
    if numbers(text) != numbers(original):
        return False, "numbers changed"
    missing = [n for n in proper_nouns(original) if not _has(n, text)]
    if missing:
        return False, f"names missing: {missing}"
    for term in SENSITIVE_REQUESTS.get(lang, SENSITIVE_REQUESTS["en"]):
        if _has(term, text) and not _has(term, original):
            return False, f"new request for information: {term}"
    for term in BLOCKED_TERMS:
        if _has(term, text):
            return False, f"blocked term: {term}"
    for term in AGENCY_TERMS:
        if _has(term, text) and not _has(term, original):
            return False, f"new agency: {term}"
    return True, "ok"


SYSTEM_PROMPT = (
    "You rewrite one line of dialogue for a fictional scam-awareness training drill. "
    "Vary the wording only. Keep the same meaning, tone, pressure tactics and requests. "
    "Keep every name, number, amount and the fictional bank name exactly as written. "
    "Do not add any new request, link, phone number, email, organisation or detail. "
    "Keep it about the same length (no more than 20 percent longer). "
    "Write in the same language as the original line. "
    "Output only the rewritten line, with no quotes or commentary."
)


def _anthropic_call(settings: Settings, line: str, lang: str = "en") -> str:
    # Imported lazily so the SDK is only needed when rephrasing is switched on.
    import anthropic

    client = anthropic.Anthropic(api_key=settings.llm_api_key, timeout=TIMEOUT_SECONDS, max_retries=0)
    response = client.messages.create(
        model=settings.llm_model or "claude-opus-5-5",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        output_config={"effort": "low"},
        messages=[{"role": "user", "content": f"Language: {LANG_NAMES.get(lang, 'English')}\nLine to rewrite:\n{line}"}],
    )
    if response.stop_reason in ("refusal", "max_tokens"):
        raise RuntimeError(f"stop_reason={response.stop_reason}")
    return next((b.text for b in response.content if b.type == "text"), "")


# Provider name -> callable(settings, line, lang) -> text. Add other providers here.
PROVIDERS: dict[str, Callable[[Settings, str, str], str]] = {
    "anthropic": _anthropic_call,
}

# Test hook: async (line, lang) -> text.
Generator = Callable[[str, str], Awaitable[str]]


class Rephraser:
    def __init__(self, settings: Settings, generator: Generator | None = None):
        self.settings = settings
        self._generator = generator
        self._cache: dict[tuple[str, str, str], str] = {}

    @property
    def enabled(self) -> bool:
        if self._generator is not None:
            return self.settings.llm_enabled
        return self.settings.llm_active and self.settings.llm_provider in PROVIDERS

    async def _generate(self, line: str, lang: str) -> str:
        if self._generator is not None:
            return await self._generator(line, lang)
        call = PROVIDERS[self.settings.llm_provider]
        return await asyncio.to_thread(call, self.settings, line, lang)

    async def rephrase(self, scenario_id: str, node_id: str, original: str,
                       lang: str = "en", english: str | None = None) -> tuple[str, str]:
        """Return (say, source)."""
        if not self.enabled:
            return original, "fallback"
        key = (scenario_id, node_id, lang)
        if key in self._cache:
            return self._cache[key], "llm"
        try:
            text = await asyncio.wait_for(self._generate(original, lang), timeout=TIMEOUT_SECONDS)
        except Exception as exc:  # timeout, network, provider, refusal: all fall back
            log.info("rephrase fallback (%s): %s", key, type(exc).__name__)
            return original, "fallback"
        text = (text or "").strip().strip('"').strip("“”«»").strip()
        ok, reason = validate(original, text, lang, english)
        if not ok:
            log.info("rephrase rejected (%s): %s", key, reason)
            return original, "fallback"
        self._cache[key] = text
        return text, "llm"
