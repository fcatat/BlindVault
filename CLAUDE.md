# CLAUDE.md

> Claude Code 不原生读取 `AGENTS.md`，故此处导入，使本仓库的 Claude Code 与
> Antigravity 等工具共享同一份规约。**所有架构/决策/规约写在 `AGENTS.md`，不要在本文件重复。**

@AGENTS.md

## Claude Code 专属说明

- 本文件仅作 `AGENTS.md` 的入口；若 `AGENTS.md` 更新，本文件无需改动。
- 安全关键改动（脱敏 middleware / `resolve_secret` / 识别规则）请在本 IDE（强模型）下完成或 review，勿全权交给便宜模型。
- 结束会话前务必更新 `PROGRESS.md`（见 `AGENTS.md` 第 6 条）。
