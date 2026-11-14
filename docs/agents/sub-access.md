# Доступ сабов к студии (решение владельца 14.11: sub + 0000)

Сабы самостоятельно ходят в живую студию https://demo.briix.ru/studio/ — без «мне нужен токен» отмазок.

## Профиль входа (гейт студии)
- Ник: `sub`
- PIN: `0000`

Профиль регистрируется при первом входе (клиентский гейт). Для playwright-сабов —
предзадать сессию init-скриптом (см. tools/check-studio.cjs page()):

```js
await p.addInitScript(() => {
  localStorage.setItem('briix-studio-profiles',
    JSON.stringify({ sub: { pinHash: '<sha256(sub::0000)>', created: 0 } }));
  localStorage.setItem('briix-studio-user', 'sub');
});
```

## Токен шины (Bearer)
Токен НЕ лежит в git. Саб читает его сам на стенде (есть ssh-доступ fonotext-stand):
```bash
ssh -o BatchMode=yes fonotext-stand "grep MEDIA_BFF_TOKEN /home/badai/briix-media/media-bff/.env | cut -d= -f2-"
```
В браузере — вставить через профиль → «Ключ стенда…». В playwright — localStorage
`briix-media-live-token`. Токен не печатать в отчёты и чат.

## Этикет
- Тестовые джобы: duration ≤ 30, помечать prompt префиксом `sub-test`.
- Не удалять чужие записи из библиотеки; свои — помечать.
- Отчёты: скриншоты + маркеры живого кода (см. memory: визуальная верификация).
