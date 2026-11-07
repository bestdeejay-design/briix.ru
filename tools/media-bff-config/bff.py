#!/usr/bin/env python3
"""BRIIX media-bff — aiohttp adapter for local media backends on t-ai (fonotext-stand A).

SPEC v2 (issue briix.ru#23, Wave 1). Bind 127.0.0.1:8390.
Bearer auth mandatory even on loopback. No docker, no NFS paths.
"""
import asyncio
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path

from aiohttp import web, ClientSession, ClientTimeout

BASE = Path.home() / "briix-media" / "media-bff"
RESULTS = BASE / "results"
LOGS = BASE / "logs"
ENV_FILE = BASE / ".env"
JOBS_FILE = BASE / "jobs.json"

QUEUE_CAP = 8
RETENTION_SECONDS = 24 * 3600
IDEMPOTENCY_WINDOW = 600  # 10 min
HEAVY_TIMEOUT = 480       # image
MUSIC_TIMEOUT = 420       # S2: поднят с 300 — холодный первый music-джоб 356с
TEXT_TIMEOUT = 180
MAX_PROMPT = 4000
# S3: единый тредо-бюджет вместо независимых HEAVY_SEM+TEXT_SEM (пик 12 > квоты 8).
THREAD_BUDGET = int(os.environ.get("THREAD_BUDGET", "8"))   # image/music берут все 8
TEXT_BUDGET = int(os.environ.get("TEXT_BUDGET", "4"))       # text берёт 4
STRICT_THREADS = os.environ.get("STRICT_THREADS", "0") == "1"  # 1: text ждёт за heavy
SD_CLI = Path.home() / "briix-media" / "stable-diffusion.cpp" / "build" / "bin" / "sd-cli"
MUSIC_PY = Path.home() / "briix-media" / "musicgen-venv" / "bin" / "python"
MUSIC_CLI = Path.home() / "briix-media" / "musicgen-cli.py"  # CLI-обёртка gen.py, живёт рядом с venv
OLLAMA_TEXT = "http://127.0.0.1:11436"
TEXT_MODEL = "qwen3:4b-instruct"
ALLOWED_ORIGINS = {"http://127.0.0.1:8388", "http://localhost:8388"}
TEXT_HEALTH_TTL = 30       # S4: кэш health-проверки ollama
TEXT_HEALTH_TIMEOUT = 8    # S4: холодный :11436 отвечает дольше 3с

QUEUE: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_CAP)


class ThreadBudget:
    """Семафор на N токенов: heavy берёт все THREAD_BUDGET, text — TEXT_BUDGET.

    Пиковое потребление тредов процесса никогда не превышает THREAD_BUDGET,
    потому что сумма выданных токенов <= total (проверяется acquire-циклом).
    """

    def __init__(self, total):
        self.total = total
        self._sem = asyncio.Semaphore(total)
        self.held = 0

    async def acquire(self, n):
        # F2: атомарность при отмене посреди ожидания. Считаем взятые единицы
        # локально; при исключении (cancel) возвращаем взятое и пробрасываем.
        if n > self.total:
            raise ValueError(f"requested {n} tokens > budget {self.total}")
        got = 0
        try:
            for _ in range(n):
                await self._sem.acquire()
                got += 1
        except BaseException:
            if got:
                self.release(got)
            raise
        self.held += n

    def release(self, n):
        for _ in range(n):
            self._sem.release()
        self.held -= n


BUDGET = ThreadBudget(THREAD_BUDGET)
HEAVY_GATE = asyncio.Lock()  # STRICT_THREADS=1: text ждёт, пока идёт heavy
JOBS_LOCK = asyncio.Lock()   # S6: сериализация мутаций JOBS/IDEM (create/cancel/prune)
JOBS = {}            # job_id -> job dict
IDEM = {}            # idempotency key -> (job_id, ts)
PROCS = {}           # job_id -> subprocess.Popen
ENABLED = True       # kill-switch: 503 when disabled (file .disabled)
_text_health_cache = {"ts": 0.0, "ok": False}  # S4


def log(msg):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n"
    try:
        LOGS.mkdir(parents=True, exist_ok=True)
        # simple 10MB x 3 rotation
        f = LOGS / "bff.log"
        if f.exists() and f.stat().st_size > 10 * 1024 * 1024:
            for i in (2, 1):
                (LOGS / f"bff.log.{i}").exists() and shutil.move(LOGS / f"bff.log.{i}", LOGS / f"bff.log.{i+1}")
            shutil.move(f, LOGS / "bff.log.1")
        with open(f, "a") as fh:
            fh.write(line)
    except OSError:
        pass
    sys.stderr.write(line)
    sys.stderr.flush()


def load_token():
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith("MEDIA_BFF_TOKEN="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("MEDIA_BFF_TOKEN missing")


TOKEN = load_token()


def save_jobs():
    try:
        tmp = JOBS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(list(JOBS.values())))
        tmp.replace(JOBS_FILE)
    except OSError as e:
        log(f"save_jobs failed: {e}")


def load_jobs():
    # After a restart, anything that was running is now interrupted.
    try:
        for j in json.loads(JOBS_FILE.read_text()):
            if j.get("status") == "running":
                j["status"] = "interrupted"
                j["error"] = "server restarted while job was running"
            JOBS[j["id"]] = j
    except (OSError, ValueError):
        pass


def envelope(code, message, error_code, request=None):
    body = {"error": {"code": error_code, "message": message}}
    rid = request.get("request_id") if request else None
    if rid:
        body["error"]["request_id"] = rid
    resp = web.json_response(body, status=code)
    if rid:
        resp.headers["X-Request-Id"] = rid
    return resp


def auth_ok(request):
    h = request.headers.get("Authorization", "")
    return h == f"Bearer {TOKEN}"


def cors_headers(request, resp):
    origin = request.headers.get("Origin")
    if origin in ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Vary"] = "Origin"
    return resp


async def preflight(request):
    resp = web.Response(status=204)
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "authorization,idempotency-key,content-type"
    resp.headers["Access-Control-Max-Age"] = "600"
    return cors_headers(request, resp)


@web.middleware
async def middleware(request, handler):
    # S5: auth до роутинга — несуществующий маршрут без токена даёт 401, а не 405/404.
    request["request_id"] = uuid.uuid4().hex[:12]
    if request.method != "OPTIONS" and request.path != "/health":
        guard = check_auth(request)
        if guard:
            return cors_headers(request, guard)
    try:
        resp = await handler(request)
    except web.HTTPException as e:
        resp = envelope(e.status, e.reason, f"http_{e.status}", request)
    except Exception as e:  # never leak stack traces or host paths
        log(f"internal error on {request.path}: {type(e).__name__}")
        resp = envelope(500, "Внутренняя ошибка сервиса.", "internal", request)
    if request.get("request_id"):
        resp.headers.setdefault("X-Request-Id", request["request_id"])
    return cors_headers(request, resp)


def check_auth(request):
    if not auth_ok(request):
        return envelope(401, "Требуется bearer-токен.", "unauthorized", request)
    if not ENABLED or (BASE / ".disabled").exists():
        return envelope(503, "Сервис выключен.", "disabled", request)
    return None


async def backend_available(kind):
    if kind == "image":
        return SD_CLI.exists() and os.access(SD_CLI, os.X_OK)
    if kind == "music":
        return MUSIC_PY.exists() and MUSIC_CLI.exists()
    if kind == "text":
        # S4: кэш 30с + таймаут 8с — холодный :11436 не должен выглядеть мёртвым.
        now = time.time()
        if now - _text_health_cache["ts"] < TEXT_HEALTH_TTL:
            return _text_health_cache["ok"]
        ok = False
        try:
            async with ClientSession() as s:
                async with s.get(f"{OLLAMA_TEXT}/api/tags", timeout=ClientTimeout(total=TEXT_HEALTH_TIMEOUT)) as r:
                    ok = r.status == 200
        except Exception:
            ok = False
        _text_health_cache["ts"] = now
        _text_health_cache["ok"] = ok
        return ok
    return False


async def health(request):
    image = await backend_available("image")
    music = await backend_available("music")
    text = await backend_available("text")
    return web.json_response({
        "ok": True,
        "queue_len": sum(1 for j in JOBS.values() if j["status"] == "queued"),
        "running": sum(1 for j in JOBS.values() if j["status"] == "running"),
        # capability granularity per model-bus contract (PR #24): ready | unavailable
        "backends": {
            "image": "ready" if image else "unavailable",
            "music": "ready" if music else "unavailable",
            "text": "ready" if text else "unavailable",
        },
    })


async def create_job(request):
    guard = check_auth(request)
    if guard:
        return guard
    try:
        body = await request.json()
    except Exception:
        return envelope(400, "Тело запроса должно быть корректным JSON.", "bad_json", request)
    if not isinstance(body, dict):
        return envelope(400, "Тело запроса должно быть JSON-объектом.", "bad_schema", request)
    jtype = body.get("type")
    prompt = body.get("prompt")
    params = body.get("params") or {}
    if jtype not in ("image", "music", "text"):
        return envelope(400, "type должен быть image, music или text.", "bad_type", request)
    if not isinstance(prompt, str) or not (1 <= len(prompt) <= MAX_PROMPT):
        return envelope(400, f"prompt обязателен, строка 1..{MAX_PROMPT} символов.", "bad_prompt", request)
    if not isinstance(params, dict):
        return envelope(400, "params должен быть объектом.", "bad_params", request)

    if not await backend_available(jtype):
        return envelope(503, f"Бэкенд {jtype} недоступен.", "backend_unavailable", request)

    # Idempotency-Key: repeat within 10 min returns the same job_id.
    idem = request.headers.get("Idempotency-Key")
    now = time.time()
    # S6: check-then-act по JOBS/IDEM идёт под общим локом (гонка двух POST).
    async with JOBS_LOCK:
        for k in [k for k, (_, ts) in IDEM.items() if now - ts > IDEMPOTENCY_WINDOW]:
            IDEM.pop(k, None)
        if idem:
            hit = IDEM.get(idem)
            if hit and hit[0] in JOBS:
                resp = web.json_response({"job_id": hit[0]}, status=202)
                resp.headers["Idempotency-Replayed"] = "true"
                return resp

        active = sum(1 for x in JOBS.values() if x["status"] in ("queued", "running"))
        if active >= QUEUE_CAP:
            resp = envelope(429, "Очередь заполнена. Повторите позже.", "queue_full", request)
            resp.headers["Retry-After"] = "30"
            return resp

        job_id = "job-" + hashlib.sha256(f"{idem or ''}{now}{prompt}{jtype}{os.urandom(8)}".encode()).hexdigest()[:16]
        job = {
            "id": job_id, "type": jtype, "prompt": prompt,
            "params": {k: v for k, v in params.items() if isinstance(v, (str, int, float, bool))},
            "status": "queued", "result_url": None, "error": None,
            "provenance": {"model": {"image": "flux-2-klein-4b (sd.cpp)", "music": "musicgen-small",
                                     "text": TEXT_MODEL}[jtype],
                           "params": params if isinstance(params, dict) else {},
                           "wall_clock_ms": None, "queued_ms": None,
                           # model-bus contract (PR #24): MusicGen is instrumental-only,
                           # never present or labelled as vocal on any layer.
                           **({"capability": "instrumental"} if jtype == "music" else {})},
            "created_at": now, "started_at": None, "finished_at": None,
        }
        JOBS[job_id] = job
        if idem:
            IDEM[idem] = (job_id, now)
        save_jobs()
    await QUEUE.put(job_id)
    log(f"queued {job_id} type={jtype} queue={QUEUE.qsize()}")
    return web.json_response({"job_id": job_id}, status=202)


async def get_job(request):
    guard = check_auth(request)
    if guard:
        return guard
    j = JOBS.get(request.match_info["id"])
    if not j:
        return envelope(404, "Задача не найдена.", "job_not_found", request)
    out = {"id": j["id"], "type": j["type"], "status": j["status"],
           "provenance": j["provenance"]}
    if j["status"] == "running" and j.get("stage"):
        out["stage"] = j["stage"]  # S2: music отдаёт model-warmup|generating
    if j["status"] == "ready":
        out["result_url"] = f"/files/{j['id']}"
        # S9: метаданные результата (checksum/ttl считаются от готового файла).
        out["file_id"] = j.get("file_id") or j["id"]
        out["mime"] = j.get("mime")
        out["size"] = j.get("size")
        out["checksum"] = j.get("checksum")
        out["ttl_seconds"] = max(0, int(RETENTION_SECONDS - (time.time() - (j.get("finished_at") or time.time()))))
    if j.get("error"):
        out["error"] = j["error"]
    return web.json_response(out)


async def cancel_job(request):
    guard = check_auth(request)
    if guard:
        return guard
    j = JOBS.get(request.match_info["id"])
    if not j:
        return envelope(404, "Задача не найдена.", "job_not_found", request)
    if j["status"] in ("ready", "error", "cancelled"):
        # Idempotent: cancelling a settled job is a no-op success.
        return web.json_response({"id": j["id"], "status": j["status"]})
    if j["status"] == "interrupted":
        return envelope(409, "Задача прервана рестартом сервера; отмена невозможна.", "conflict", request)
    async with JOBS_LOCK:  # S6: мутация статуса + save под локом
        if j["status"] not in ("queued", "running"):
            # Settled, пока брали лок: идемпотентный no-op.
            return web.json_response({"id": j["id"], "status": j["status"]})
        j["status"] = "cancelled"
        j["finished_at"] = time.time()
        j["stage"] = None
        proc = PROCS.pop(j["id"], None)
        if proc and proc.poll() is None:
            kill_tree(proc)
            log(f"killed process group for {j['id']} on cancel")
        save_jobs()
    log(f"cancelled {j['id']}")
    return web.json_response({"id": j["id"], "status": "cancelled"})


async def get_file(request):
    guard = check_auth(request)
    if guard:
        return guard
    jid = request.match_info["id"]
    j = JOBS.get(jid)
    if not j or j["status"] != "ready":
        return envelope(404, "Файл не найден или срок хранения истёк.", "file_gone", request)
    ext = {"image": ".png", "music": ".wav", "text": ".txt"}[j["type"]]
    path = RESULTS / f"{jid}{ext}"
    if not path.exists():
        return envelope(404, "Файл не найден или срок хранения истёк.", "file_gone", request)
    mime = {"image": "image/png", "music": "audio/wav", "text": "text/plain; charset=utf-8"}[j["type"]]
    return web.Response(body=path.read_bytes(), content_type=mime.split(";")[0],
                        charset="utf-8" if j["type"] == "text" else None)


# S7: каталог модели-шины (контракт Арены, PR #24). Только измеренные факты;
# непроверенное помечено source:"estimate"/"none", а не выдуманными числами.
MODELS_CATALOG = [
    {
        "id": "qwen3:4b-instruct", "object": "model",
        "capabilities": ["chat", "text.generate"], "status": "ready",
        "limits": {"max_duration_seconds": TEXT_TIMEOUT, "max_concurrent_jobs": 1},
        "license_scope": "demo-only",
        "latency": {"source": "measured", "seconds": None, "conditions":
                    "CPU 8 тредов; первые токены — секунды, полный ответ зависит от длины"},
    },
    {
        "id": "flux-2-klein-4b", "object": "model",
        "capabilities": ["image.generate"], "status": "ready",
        "limits": {"max_duration_seconds": HEAVY_TIMEOUT, "max_concurrent_jobs": 1},
        "license_scope": "demo-only",
        "latency": {"source": "measured", "seconds": 261, "conditions":
                    "холодный и тёплый прогон сопоставимы (модель грузится в RAM bff-хоста)"},
    },
    {
        "id": "musicgen-small", "object": "model",
        "capabilities": ["music.generate"], "status": "ready",
        "limits": {"max_duration_seconds": MUSIC_TIMEOUT, "max_concurrent_jobs": 1},
        "license_scope": "demo-only",
        "latency": {"source": "measured", "seconds": 80, "conditions":
                    "инструментал; тёплый прогон ~80с, холодный (первый после рестарта) ~356с — bff прогревает модель на старте"},
    },
    {
        "id": "ace-step-1.5", "object": "model",
        "capabilities": ["song.vocal"], "status": "unavailable",
        "limits": {"max_duration_seconds": None, "max_concurrent_jobs": 0},
        "license_scope": "demo-only",
        "latency": {"source": "none", "seconds": None, "conditions":
                    "пилот ace-step.cpp не проведён; до вердикта пилота route не открывается"},
    },
]


async def list_models(request):
    return web.json_response({"object": "list", "data": MODELS_CATALOG})


def messages_to_prompt(messages):
    parts = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        parts.append(f"{role}: {content}")
    parts.append("assistant:")
    return "\n".join(parts)


def validate_chat_body(body):
    if not isinstance(body, dict):
        return "Тело запроса должно быть JSON-объектом."
    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        return "messages обязателен, непустой массив."
    for m in messages:
        if not isinstance(m, dict) or not isinstance(m.get("content"), str) \
                or m.get("role") not in ("system", "user", "assistant"):
            return "messages: каждый элемент — {role: system|user|assistant, content: string}."
    return None


async def chat_completions(request):
    try:
        body = await request.json()
    except Exception:
        return envelope(400, "Тело запроса должно быть корректным JSON.", "bad_json", request)
    problem = validate_chat_body(body)
    if problem:
        return envelope(400, problem, "bad_schema", request)
    rid = request["request_id"]
    prompt = messages_to_prompt(body["messages"])
    payload = {"model": TEXT_MODEL, "prompt": prompt, "stream": bool(body.get("stream")),
               "options": {"num_thread": TEXT_BUDGET}, "keep_alive": "5m"}

    def err_event(code, message, error_code):
        return {"error": {"code": error_code, "message": message, "request_id": rid}}

    # F1: chat_completions идёт через общий тредо-бюджет, как и job-путь.
    if not await backend_available("text"):
        return envelope(503, "Бэкенд текста недоступен.", "backend_unavailable", request)
    await BUDGET.acquire(TEXT_BUDGET)
    try:
        return await _chat_ollama(request, payload, rid, err_event)
    finally:
        BUDGET.release(TEXT_BUDGET)


async def _chat_ollama(request, payload, rid, err_event):
    log(f"chat {rid} stream={payload['stream']} tokens={TEXT_BUDGET} held={BUDGET.held}")
    if not payload["stream"]:
        # Non-stream: OpenAI-подобный ответ, usage от провайдера (ollama).
        try:
            async with ClientSession() as s:
                async with s.post(f"{OLLAMA_TEXT}/api/generate", json=payload,
                                  timeout=ClientTimeout(total=TEXT_TIMEOUT)) as r:
                    if r.status != 200:
                        return envelope(502, f"Бэкенд текста вернул http {r.status}.", "upstream_error", request)
                    data = await r.json()
            if not data.get("done", False):
                return envelope(502, "Бэкенд текста вернул неполный ответ.", "upstream_incomplete", request)
        except asyncio.TimeoutError:
            return envelope(504, "Бэкенд текста превысил таймаут.", "upstream_timeout", request)
        except Exception:
            return envelope(502, "Бэкенд текста недоступен.", "backend_unavailable", request)
        return web.json_response({
            "id": "chatcmpl-" + rid, "object": "chat.completion",
            "created": int(time.time()), "model": TEXT_MODEL,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": data.get("response", "")},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": data.get("prompt_eval_count"),
                      "completion_tokens": data.get("eval_count"),
                      "total_tokens": (data.get("prompt_eval_count") or 0) + (data.get("eval_count") or 0),
                      "source": "provider"},
        })

    # SSE-стрим: OpenAI-подобные chunk-объекты, [DONE] в конце.
    resp = web.StreamResponse(status=200, headers={
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache", "Connection": "keep-alive",
        "X-Request-Id": rid,
    })
    await resp.prepare(request)
    origin = request.headers.get("Origin")
    if origin in ALLOWED_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"] = origin

    def chunk(content, finish_reason=None):
        return {"id": "chatcmpl-" + rid, "object": "chat.completion.chunk",
                "created": int(time.time()), "model": TEXT_MODEL,
                "choices": [{"index": 0, "delta": {"content": content} if content else {},
                             "finish_reason": finish_reason}]}

    try:
        async with ClientSession() as s:
            async with s.post(f"{OLLAMA_TEXT}/api/generate", json=payload,
                              timeout=ClientTimeout(total=TEXT_TIMEOUT, sock_read=TEXT_TIMEOUT)) as r:
                if r.status != 200:
                    await resp.write(f"data: {json.dumps(err_event(502, 'Бэкенд текста недоступен.', 'upstream_error'), ensure_ascii=False)}\n\n".encode())
                    await resp.write(b"data: [DONE]\n\n")
                    await resp.write_eof()
                    return resp
                async for line in r.content:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        piece = json.loads(line)
                    except ValueError:
                        continue
                    if piece.get("response"):
                        await resp.write(f"data: {json.dumps(chunk(piece['response']), ensure_ascii=False)}\n\n".encode())
                    if piece.get("done", False):
                        await resp.write(f"data: {json.dumps(chunk('', 'stop'), ensure_ascii=False)}\n\n".encode())
        await resp.write(b"data: [DONE]\n\n")
        await resp.write_eof()
    except asyncio.TimeoutError:
        try:
            await resp.write(f"data: {json.dumps(err_event(504, 'Бэкенд текста превысил таймаут посреди потока.', 'upstream_timeout'), ensure_ascii=False)}\n\n".encode())
            await resp.write(b"data: [DONE]\n\n")
            await resp.write_eof()
        except (ConnectionResetError, RuntimeError):
            pass  # клиент уже отключился
    except (asyncio.CancelledError, ConnectionResetError, RuntimeError):
        # Остановка клиента (cancel/disconnect): просто закрываем поток, upstream рвётся вместе с сессией.
        try:
            await resp.write_eof()
        except (ConnectionResetError, RuntimeError):
            pass
    except Exception as e:
        # Ошибка посреди потока: SSE-событие error и закрытие (контракт S8).
        log(f"chat stream failed: {type(e).__name__}")
        try:
            await resp.write(f"data: {json.dumps(err_event(502, 'Ошибка бэкенда посреди потока.', 'upstream_error'), ensure_ascii=False)}\n\n".encode())
            await resp.write(b"data: [DONE]\n\n")
            await resp.write_eof()
        except (ConnectionResetError, RuntimeError):
            pass
    return resp


def kill_tree(proc):
    """Kill the whole process group (workers may spawn children)."""
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            proc.kill()
        except ProcessLookupError:
            pass


def run_worker(j, loop):
    """Blocking; executed in a thread. Hard timeout + process-group kill."""
    jid, jtype = j["id"], j["type"]
    ext = {"image": ".png", "music": ".wav", "text": ".txt"}[jtype]
    out = RESULTS / f"{jid}{ext}"
    RESULTS.mkdir(parents=True, exist_ok=True)
    if jtype == "image":
        cmd = [str(SD_CLI), "--diffusion-model", str(Path.home() / "briix-media/models/flux-2-klein-4b-Q8_0.gguf"),
               "--vae", str(Path.home() / "briix-media/models/full_encoder_small_decoder.safetensors"),
               "--llm", str(Path.home() / "briix-media/models/Qwen3-4B-Q6_K.gguf"),
               "--cfg-scale", "1.0", "--steps", "4", "--threads", str(THREAD_BUDGET), "--offload-to-cpu",
               "-o", str(out), "-p", j["prompt"]]
        timeout = HEAVY_TIMEOUT
    elif jtype == "music":
        # F6: передаём фактический тяжёлый бюджет тредов в CLI.
        cmd = [str(MUSIC_PY), str(MUSIC_CLI), "--prompt", j["prompt"], "--out", str(out),
               "--tokens", "750", "--threads", str(THREAD_BUDGET)]
        timeout = MUSIC_TIMEOUT
    else:
        cmd = None  # HTTP path handled by async worker

    if cmd:
        env = dict(os.environ)
        env["OMP_NUM_THREADS"] = str(THREAD_BUDGET)
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=env,
                                start_new_session=True)
        PROCS[jid] = proc
        try:
            _, err = proc.communicate(timeout=timeout)
            rc = proc.returncode
        except subprocess.TimeoutExpired:
            kill_tree(proc)
            proc.communicate()
            raise TimeoutError(f"{jtype} worker exceeded {timeout}s and was killed")
        finally:
            PROCS.pop(jid, None)
        if rc != 0 or not out.exists():
            tail = (err or b"")[-300:].decode("utf-8", "replace")
            raise RuntimeError(f"worker exit {rc}: {tail}")
        return
    raise RuntimeError("text job must not reach thread worker")


async def text_worker(j):
    jid = j["id"]
    payload = {"model": TEXT_MODEL, "prompt": j["prompt"], "stream": False,
               "options": {"num_thread": 4}, "keep_alive": "5m"}
    async with ClientSession() as s:
        async with s.post(f"{OLLAMA_TEXT}/api/generate", json=payload,
                          timeout=ClientTimeout(total=TEXT_TIMEOUT)) as r:
            if r.status != 200:
                raise RuntimeError(f"ollama http {r.status}")
            data = await r.json()
    out = RESULTS / f"{jid}.txt"
    RESULTS.mkdir(parents=True, exist_ok=True)
    out.write_text(data.get("response", ""))
    if not data.get("done", False):
        raise RuntimeError("ollama response incomplete")


async def executor():
    """Single consumer: dispatches jobs under the shared thread budget (S3)."""
    loop = asyncio.get_running_loop()
    while True:
        jid = await QUEUE.get()
        j = JOBS.get(jid)
        if not j or j["status"] != "queued":
            QUEUE.task_done()
            continue
        async def run_one(j, jid):
            is_text = j["type"] == "text"
            tokens = TEXT_BUDGET if is_text else THREAD_BUDGET
            try:
                # S3 strict-режим: text стартует только когда ни один heavy не идёт.
                if is_text and STRICT_THREADS:
                    await HEAVY_GATE.acquire()
                    gate_held = True
                else:
                    gate_held = False
                try:
                    await BUDGET.acquire(tokens)
                    try:
                        if j["status"] != "queued":  # cancelled while waiting in queue
                            log(f"skip {jid}: cancelled before start")
                            return
                        j["provenance"]["queued_ms"] = round((time.time() - j["created_at"]) * 1000)
                        j["status"] = "running"
                        j["started_at"] = time.time()
                        # S2: music начинается в стадии прогрева модели.
                        j["stage"] = "model-warmup" if j["type"] == "music" else None
                        save_jobs()
                        log(f"running {jid} tokens={tokens} held={BUDGET.held} strict={STRICT_THREADS}")
                        watcher = None
                        if j["type"] == "music":
                            watcher = asyncio.ensure_future(music_stage_watcher(j))
                        try:
                            if is_text:
                                await text_worker(j)
                            else:
                                await loop.run_in_executor(None, run_worker, j, None)
                        finally:
                            if watcher:
                                watcher.cancel()
                        j["stage"] = None
                    finally:
                        BUDGET.release(tokens)
                finally:
                    if gate_held:
                        HEAVY_GATE.release()
                # S9: метаданные файла результата.
                ext = {"image": ".png", "music": ".wav", "text": ".txt"}[j["type"]]
                path = RESULTS / f"{jid}{ext}"
                if path.exists():
                    h = hashlib.sha256()
                    with open(path, "rb") as fh:
                        for chunk in iter(lambda: fh.read(1 << 20), b""):
                            h.update(chunk)
                    j["file_id"] = jid
                    j["mime"] = {"image": "image/png", "music": "audio/wav", "text": "text/plain; charset=utf-8"}[j["type"]]
                    j["size"] = path.stat().st_size
                    j["checksum"] = h.hexdigest()
                j["status"] = "ready"
                j["provenance"]["wall_clock_ms"] = round((time.time() - j["started_at"]) * 1000)
                j["finished_at"] = time.time()
                log(f"ready {jid} wall={j['provenance']['wall_clock_ms']}ms")
            except asyncio.CancelledError:
                raise
            except TimeoutError as e:
                if j["status"] != "cancelled":
                    j["status"] = "error"
                    j["error"] = str(e)
                log(f"timeout {jid}")
            except Exception as e:
                if j["status"] != "cancelled":
                    j["status"] = "error"
                    j["error"] = f"Ошибка воркера ({type(e).__name__})."
                log(f"failed {jid}: {type(e).__name__}")
            finally:
                j["stage"] = None
                if j["status"] != "cancelled":
                    save_jobs()
        asyncio.ensure_future(run_one(j, jid))
        QUEUE.task_done()


async def music_stage_watcher(j):
    """S2: flips stage model-warmup -> generating once the WAV has content."""
    ext = RESULTS / f"{j['id']}.wav"
    while j["status"] == "running" and j.get("stage") != "generating":
        try:
            if ext.exists() and ext.stat().st_size > 0:
                j["stage"] = "generating"
                save_jobs()  # F7: stage-апдейты фиксируются в jobs.json сразу
                log(f"stage generating {j['id']}")
                return
        except OSError:
            pass
        await asyncio.sleep(5)


def prune_records(cutoff):
    """S1: retention 24ч для САМИХ записей jobs.json (иначе растут бесконечно).

    - ready-джоб без файла на диске -> запись удаляется (клиент получает 404 и
      сам показывает «результат истёк»);
    - settled-джоб (готов/ошибка/отменён/прерван/истёк) старше 24ч -> запись удаляется;
    - queued/running не трогаем никогда.
    """
    removed = 0
    for jid in list(JOBS.keys()):
        j = JOBS[jid]
        if j["status"] in ("queued", "running"):
            continue
        if j["status"] == "ready":
            ext = {"image": ".png", "music": ".wav", "text": ".txt"}[j["type"]]
            if not (RESULTS / f"{jid}{ext}").exists():
                del JOBS[jid]
                removed += 1
                continue
        settled_at = j.get("finished_at") or j.get("created_at") or 0
        if settled_at and settled_at < cutoff:
            del JOBS[jid]
            removed += 1
    if removed:
        save_jobs()
    return removed


async def retention():
    """Hourly: delete results older than 24h, mark expired, prune job records."""
    while True:
        await asyncio.sleep(3600)
        cutoff = time.time() - RETENTION_SECONDS
        for p in RESULTS.iterdir():
            try:
                if p.is_file() and p.stat().st_mtime < cutoff:
                    p.unlink()
                    jid = p.stem
                    if jid in JOBS and JOBS[jid]["status"] == "ready":
                        JOBS[jid]["status"] = "expired"
                        save_jobs()
                    log(f"retention deleted {p.name}")
            except OSError as e:
                log(f"retention error {p.name}: {e}")
        async with JOBS_LOCK:
            removed = prune_records(time.time() - RETENTION_SECONDS)
        if removed:
            log(f"retention pruned {removed} job records")


def cleanup_once():
    """Idempotent retention pass for the hourly cron entry (S1: now loads JOBS)."""
    load_jobs()
    cutoff = time.time() - RETENTION_SECONDS
    removed = 0
    if RESULTS.exists():
        for p in RESULTS.iterdir():
            if p.is_file() and p.stat().st_mtime < cutoff:
                p.unlink(missing_ok=True)
                removed += 1
    pruned = prune_records(cutoff)
    print(f"cleanup: removed {removed} files, pruned {pruned} job records")
    return 0


async def music_warmup():
    """S2: прогрев musicgen при старте bff (холодный прогон 356с > старого таймаута).

    Короткий прогон с малым числом токенов грузит модель в память; image-воркер
    при этом не стартует (прогрев идёт мимо очереди и бюджета; F5: дополнительно
    ждёт освобождения тредо-бюджета). Признаём честно (F5): прогрев греет
    page-cache модели на диске, а не RAM — модель всё равно грузится в процесс
    при первом джобе, но чтение уже тёплое. Пропускается, если music-джоб уже
    queued/running.
    """
    await asyncio.sleep(3)  # дать стартовать сервису и логам
    if any(j["type"] == "music" and j["status"] in ("queued", "running") for j in JOBS.values()):
        log("warmup skipped: music job already active")
        return
    if not (MUSIC_PY.exists() and MUSIC_CLI.exists()):
        log("warmup skipped: music backend missing")
        return
    out = RESULTS / "warmup.wav"
    # F5: не стартуем прогрев, пока тредо-бюджет занят реальными джобами.
    waited = 0
    while BUDGET.held != 0:
        if waited == 0:
            log(f"warmup gate: budget held={BUDGET.held}, waiting")
        await asyncio.sleep(5)
        waited += 5
        if waited >= MUSIC_TIMEOUT:
            log("warmup skipped: budget busy too long")
            return
    cmd = [str(MUSIC_PY), str(MUSIC_CLI), "--prompt", "warmup ping", "--out", str(out),
           "--tokens", "128", "--threads", str(THREAD_BUDGET)]
    env = dict(os.environ)
    env["OMP_NUM_THREADS"] = str(THREAD_BUDGET)
    started = time.time()
    log("music warmup started")
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL,
                                                stderr=asyncio.subprocess.PIPE, env=env,
                                                start_new_session=True)
    try:
        await asyncio.wait_for(proc.communicate(), timeout=MUSIC_TIMEOUT)
        log(f"music warmup done in {round(time.time() - started)}s rc={proc.returncode}")
    except asyncio.TimeoutError:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
        log(f"music warmup timeout after {round(time.time() - started)}s")
    except asyncio.CancelledError:
        raise


async def start_background(app):
    app["executor"] = asyncio.create_task(executor())
    app["retention"] = asyncio.create_task(retention())
    app["warmup"] = asyncio.create_task(music_warmup())


def main():
    load_jobs()
    app = web.Application(middlewares=[middleware], client_max_size=64 * 1024)
    app.router.add_route("OPTIONS", "/{path:.*}", preflight)
    app.router.add_get("/health", health)
    app.router.add_post("/jobs", create_job)
    app.router.add_get("/jobs/{id}", get_job)
    app.router.add_post("/jobs/{id}/cancel", cancel_job)
    app.router.add_get("/files/{id}", get_file)
    app.router.add_get("/v1/models", list_models)
    app.router.add_post("/v1/chat/completions", chat_completions)
    app.on_startup.append(start_background)
    log("media-bff starting on 127.0.0.1:8390")
    web.run_app(app, host="127.0.0.1", port=8390, print=None)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "cleanup":
        sys.exit(cleanup_once())
    main()
