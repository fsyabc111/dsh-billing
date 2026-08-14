# dsh-billing

DeepSeek Harness 计费插件：按所选模型计算当前会话花费（人民币），并提供"当日消耗"汇总与可选明细落盘。

## 功能

- **「消耗」标签页**：在对话视图环新增「消耗」页签（与「对话」「轨迹」并列），含：汇总卡（总花费 / 输入 / 缓存命中 / 输出）、按模型环形图、每轮花费柱状图（高峰橙 / 空闲蓝）、累计花费折线、可展开的每轮/每步明细。
- **按模型计价**：价格表 key = `provider/model`（`deepseek-official/deepseek-v4-flash`、`deepseek-official/deepseek-v4-pro`），未知模型回落到兜底价。
- **峰谷计价**：按官方峰谷时段（UTC 01:00–04:00、06:00–10:00 为高峰，其余空闲）取价，人民币口径。
- **日汇总**：`$DSH_HOME/billing-daily.json` 按本地自然日累计（跨 web+CLI、跨重启）。
- **明细落盘**：可选，开启后写 `$DSH_HOME/billing-logs/YYYY-MM-DD.jsonl`。

## 安装

```sh
# 在插件仓库根目录执行。link: 依赖不会替被链接的仓库安装依赖，
# 因此必须先安装本插件声明的运行时依赖（包括 zod）。
cd /path/to/dsh-billing
pnpm install --frozen-lockfile

# dsh plugin 会在 profile 目录中运行 pnpm；使用绝对路径，避免 link:
# 相对路径被按 profile 目录解析。
dsh plugin --profile web add "link:$PWD"
dsh web
```

之后重启 `dsh web` 即可生效。更新本插件的依赖或切换分支后，重新执行
`pnpm install --frozen-lockfile`。

## 配置

首次运行会把默认价表写入 `$DSH_HOME/billing.json`。字段：

- `currency`：显示币种（`CNY`）。
- `priceModel`：`peak-off-peak`（峰谷计价）。
- `peakWindowsUtc`：高峰时段窗口（UTC，`start`/`end` 为 `HH:MM`）。
- `fallback`：未知模型的兜底 `{ provider, model }`。
- `displayDecimals`：显示小数位（默认 `4`，低于 `0.0001` 显示 `< ¥0.0001`）。
- `logging.enabled` / `logging.dir`：明细落盘开关与目录。
- `models`：`provider/model` → `{ peak, offPeak }`，每档 `{ input, cacheRead, output, cacheWrite }`（人民币元 / 百万 token）。

默认价格（人民币元 / 百万 token）：

| 模型 | 时段 | 输入(未命中) | 缓存命中 | 输出 |
|---|---|---|---|---|
| v4-flash | 空闲 | 1.5 | 0.05 | 4.5 |
| v4-flash | 高峰 | 3.0 | 0.10 | 9.0 |
| v4-pro | 空闲 | 4.5 | 0.15 | 13.5 |
| v4-pro | 高峰 | 9.0 | 0.30 | 27.0 |

改完价格表需重启 `dsh web` 生效。

## 计费口径

- 输入（`inputTokens`，缓存未命中）、缓存命中（`cacheReadTokens`）、输出（`outputTokens`）分别计价；`cacheWriteTokens` 字段保留但对 `deepseek-official` 永不产生。
- `reasoningTokens` 已含在 `outputTokens` 内，不重复计价。
- 会话内花费按 `(turn, step)` 去重（`assistant/message` 最终样本覆盖 `assistant/chunk` 早期样本），避免双计。
- 本插件为**参考估算**，非官方账单。
