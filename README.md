# Экспериментальный стенд frontend-архитектур

Стенд предназначен для контролируемого сравнения четырех frontend-архитектур по метрикам производительности, поведения под нагрузкой и масштабируемости кода.

## Архитектуры для сравнения

- SPA с Redux как CSR baseline
- Micro Frontends на Module Federation
- SSR + CSR
- Jamstack

## Базовый принцип эксперимента

Все frontend-реализации должны использовать:

- единый backend API;
- одинаковые тестовые данные;
- одинаковый пользовательский сценарий;
- одинаковый визуальный и функциональный состав экранов.

Изменяемая переменная эксперимента — только архитектурный подход.

## Структура

```text
experiment-stand/
  apps/
    backend/              REST API и генерация данных
    spa-redux/            SPA с Redux
    micro-shell/          shell для Micro Frontends
    micro-list/           remote-модуль списка
    micro-detail/         remote-модуль детали
    ssr-csr/              SSR + CSR приложение
    jamstack/             SSG + API приложение
  packages/
    shared-contracts/     общие типы и контракт API
    metrics-runner/       запуск сценариев и сбор метрик
  experiments/
    scenarios/            описания пользовательских сценариев
    results/              raw-результаты измерений
    reports/              агрегированные отчеты
```

## Первый запуск

```bash
npm install
npm run seed:1000
npm run dev:backend
```

Backend по умолчанию запускается на `http://localhost:4000`.

## Docker-развертывание

Для воспроизводимого запуска стенда подготовлены `Dockerfile` и `docker-compose.yml`.

### Быстрый старт

```bash
npm run docker:build
npm run docker:up
```

После запуска доступны:

- backend: `http://localhost:4000/health`
- spa-redux: `http://localhost:5102`
- micro-shell: `http://localhost:5103`
- ssr-csr: `http://localhost:5104`
- jamstack: `http://localhost:5105`
- micro remotes: `http://localhost:5111/remoteEntry.js`, `http://localhost:5112/remoteEntry.js`, `http://localhost:5113/remoteEntry.js`

Остановка стенда:

```bash
npm run docker:down
```

Просмотр логов:

```bash
npm run docker:logs
```

Для Micro Frontends remote-модули нужно запускать в preview-режиме после сборки, так как federation `remoteEntry.js` формируется на этапе build:

```bash
npm run build:micro-list
npm run build:micro-detail
npm run build:micro-crud
npm run build:micro-shell
npm run preview:micro-list
npm run preview:micro-detail
npm run preview:micro-crud
npm run preview:micro-shell
```

## Контроль внешних факторов

При измерениях runner должен:

- очищать browser cache перед каждым проходом;
- использовать одинаковые network throttling и CPU throttling;
- фиксировать версии Node.js, Chrome и зависимостей;
- выполнять не менее 15 повторов для каждой экспериментальной ячейки;
- сохранять raw-данные каждого запуска.

Основные отчеты разделяются по группам метрик:

- `page-load` — Lighthouse: LCP, FCP, TTI/INP, TBT, CLS, JS bundle, requests;
- `interaction` — Playwright scenario: длительность сценария, память, long tasks, requests;
- `concurrency` — Playwright load runner: successful/failed sessions, p95, wall-clock duration;
- `code-scalability` — статический анализ: LOC, module count, dependency edges, average dependencies per module, build chunks.

## Параллельная пользовательская нагрузка

Для моделирования одновременных пользователей используется Playwright load runner. Он запускает несколько независимых browser contexts и выполняет один и тот же сценарий параллельно.

```bash
npm --workspace packages/metrics-runner run load -- --architecture=spa-redux --scenario=user-flow --dataSize=10000 --users=50 --run=1
```

Параметр `--users` в этом режиме означает количество одновременных браузерных сессий. Для локальной машины рекомендуется сначала проверять малые значения (`2`, `5`, `10`), а затем переходить к профилям `50 / 100 / 500` при достаточных ресурсах.

Итоговый JSON содержит:

- агрегированные метрики (`scenarioDurationMs`, `p95ScenarioDurationMs`, `wallClockDurationMs`, `memoryMb`, `longTasksCount`);
- количество успешных и упавших сессий;
- детальные per-session результаты.

## Оркестратор эксперимента

Для воспроизводимого запуска серии измерений используется orchestrator:

```bash
npm --workspace packages/metrics-runner run experiment -- --mode=scenario --architectures=all --scenarios=user-flow --dataSizes=100,1000,10000 --users=50,100 --runs=15
```

По умолчанию orchestrator выполняет warm-up (`--warmupRuns=3`) перед измеряемыми повторами. Для отключения:

```bash
npm --workspace packages/metrics-runner run experiment -- --mode=scenario --architectures=all --scenarios=user-flow --dataSizes=100,1000,10000 --users=50,100 --runs=15 --warmupRuns=0
```

Перед длинным запуском рекомендуется проверить матрицу без выполнения:

```bash
npm --workspace packages/metrics-runner run experiment -- --mode=scenario --architectures=all --scenarios=user-flow --dataSizes=100,1000,10000 --users=50,100 --runs=15 --dryRun=true
```

Для реальной параллельной браузерной нагрузки:

```bash
npm --workspace packages/metrics-runner run experiment -- --mode=load --architectures=spa-redux --scenarios=user-flow --dataSizes=10000 --users=50 --runs=15
```

Для полного page-load прогона по всем архитектурам (Lighthouse):

```bash
npm --workspace packages/metrics-runner run experiment -- --mode=page-load --architectures=all --scenarios=user-flow --dataSizes=100,1000,10000 --users=50,100 --runs=15
```

Для полного нагрузочного прогона по всем профилям и размерам данных:

```bash
npm --workspace packages/metrics-runner run experiment -- --mode=load --architectures=all --scenarios=user-flow --dataSizes=100,1000,10000 --users=50,100,500 --runs=15
```

Для smoke-check с меньшим числом повторов нужно явно указать `--allowPilot=true`. Основной эксперимент не запускается с `--runs < 15`.

## Углубленный профиль для micro-frontends

Для сравнения baseline/нагрузки по micro-frontends рекомендуется запускать отдельные серии:

```bash
npm --workspace packages/metrics-runner run experiment -- --mode=scenario --architectures=micro-frontends --scenarios=user-flow --dataSizes=100,1000,10000 --users=50,100 --runs=7 --allowPilot=true --strictMain=false --cleanResults=true --cleanReports=true
```

В interaction-метриках для `micro-frontends` дополнительно фиксируются:

- `mfWaterfallRequests` / `mfWaterfallDurationMs` — размер и длительность waterfall;
- `mfRemoteEntryRequests` / `mfRemoteScriptRequests` / `mfBackendRequests` — структура запросов;
- `mfTimeToFirstModuleMs` — время до загрузки первого remote-модуля;
- `mfCompositionTimeMs` — время до композиции shell + list remote.

Variability (`sd`, `p95`) по этим метрикам автоматически попадает в `metrics-summary`.

Чтобы исключить загрязнение историческими данными, можно очищать raw/result отчеты перед запуском:

```bash
npm --workspace packages/metrics-runner run experiment -- --mode=scenario --architectures=all --scenarios=user-flow --dataSizes=100,1000,10000 --users=50,100 --runs=15 --cleanResults=true --cleanReports=true
```

По умолчанию включен `--strictMain=true`: для main-прогонов (без `--allowPilot=true`) orchestrator требует:

- `--cleanResults=true`
- `--cleanReports=true`
- `--warmupRuns > 0`

Для отладочных локальных запусков это можно временно отключить:

```bash
npm --workspace packages/metrics-runner run experiment -- --mode=scenario --architectures=spa-redux --scenarios=user-flow --dataSizes=100 --users=50 --runs=15 --strictMain=false
```

Перед main-серией orchestrator выполняет preflight-проверки (доступность backend/frontend и build-артефакты).  
Отключить preflight можно только при `--strictMain=false`:

```bash
npm --workspace packages/metrics-runner run experiment -- --mode=scenario --architectures=spa-redux --scenarios=user-flow --dataSizes=100 --users=50 --runs=15 --strictMain=false --skipPreflight=true
```

По умолчанию перед очисткой (`cleanResults/cleanReports`) JSON-файлы архивируются в `experiments/archive/...` (`--archiveBeforeClean=true`).
Если архивирование не нужно:

```bash
npm --workspace packages/metrics-runner run experiment -- --mode=scenario --architectures=all --scenarios=user-flow --dataSizes=100,1000,10000 --users=50,100 --runs=15 --cleanResults=true --cleanReports=true --archiveBeforeClean=false
```

Перед запуском orchestrator также сохраняет manifest серии в `experiments/archive/manifests/series-<timestamp>.json`:

- полный `plan` запуска;
- runtime-метаданные orchestrator (включая `gitCommit`, `gitBranch`, host snapshot);
- расписание seed для warm-up и измеряемых прогонов.

Каждый raw-result теперь содержит `seriesId`, и strict export проверяет:

- отсутствие пропусков `seriesId`;
- отсутствие смешения разных `seriesId` в одном отчете.

Raw-result также содержит runtime-метаданные браузера (`chromeVersion`) для Lighthouse и Playwright запусков.

Orchestrator автоматически вызывает backend endpoint `/seed?size=...` перед каждым отдельным запуском архитектуры. Это гарантирует, что при переходе между `100 / 1000 / 10000` реально меняется активный dataset, а CRUD-операции из предыдущего прогона не влияют на следующий повтор.

После каждого набора повторов orchestrator автоматически строит отчеты только с фильтрами:

- `--scenario=...`
- `--dataSize=...`
- `--users=...`

Это исключает смешивание разных сценариев, режимов измерения и размеров данных в одном отчете.

Также orchestrator автоматически экспортирует сводные файлы соответствующей группы метрик:

- `metrics-summary-....json`
- `metrics-summary-....csv`

Ручной экспорт можно выполнить так:

```bash
npm --workspace packages/metrics-runner run export:metrics -- --scenario=common-user-flow --dataSize=10000 --users=50 --format=csv
```

Для ручного экспорта конкретной группы:

```bash
npm --workspace packages/metrics-runner run export:metrics -- --scenario=common-user-flow --dataSize=10000 --users=50 --mode=single-playwright-scenario --group=interaction --format=csv
```

Для page-load группы нужно явно указывать mode:

```bash
npm --workspace packages/metrics-runner run export:metrics -- --scenario=common-user-flow --dataSize=10000 --users=50 --mode=lighthouse-page-load --group=page-load --format=csv
```

По умолчанию export в strict-режиме проверяет консистентность runtime:

- одинаковый `gitCommit` у включенных в отчет raw-запусков;
- ограничение на разброс `runtime.host.freeMemoryMb` (по умолчанию `2048` MB).
- полную матрицу `run` без пропусков и дублей в диапазоне `runMin..runMax`.

Переопределить порог можно флагом:

```bash
npm --workspace packages/metrics-runner run export:metrics -- --scenario=common-user-flow --dataSize=10000 --users=50 --mode=single-playwright-scenario --group=interaction --maxFreeMemorySpreadMb=1024
```

Для отладки можно отключить runtime-gate:

```bash
npm --workspace packages/metrics-runner run export:metrics -- --scenario=common-user-flow --dataSize=10000 --users=50 --mode=single-playwright-scenario --group=interaction --skipRuntimeGate=true
```

Метрики масштабируемости кода собираются отдельно:

```bash
npm run metrics:code
npm --workspace packages/metrics-runner run export:metrics -- --group=code-scalability --format=csv
```

Поддерживаемые форматы: `json`, `csv`, `md`.

## CI/CD

В репозитории добавлен workflow `.github/workflows/benchmark-cicd.yml`:

1. установка зависимостей;
2. сборка приложений;
3. расчет code-scalability метрик;
4. сборка и запуск Docker-стенда;
5. preflight-проверки;
6. пилотный сценарный прогон;
7. публикация артефактов `experiments/results` и `experiments/reports`.

Workflow запускается на `push`, `pull_request` и вручную (`workflow_dispatch`).
