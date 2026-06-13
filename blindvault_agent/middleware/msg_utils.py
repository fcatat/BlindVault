"""
消息内容提取工具——供 middleware 扫描使用。

S1 修复：覆盖 str content、list-form content blocks、tool_calls args。
"""

from __future__ import annotations

import json
from typing import Any


def extract_scannable_texts(msg: Any) -> list[str]:
    """
    从 LangChain 消息对象中提取所有可扫描的文本块。

    覆盖：
    1. str content（最常见）
    2. list-form content blocks（多模态消息，如 [{"type":"text","text":"..."}]）
    3. AIMessage 的 tool_calls 参数（模型可能在工具调用参数中泄露凭证）

    返回：文本块列表（可能为空）
    """
    texts: list[str] = []

    # 1. str content
    content = getattr(msg, 'content', None)
    if isinstance(content, str) and content:
        texts.append(content)
    elif isinstance(content, list):
        # 2. list-form content blocks
        for block in content:
            if isinstance(block, dict):
                # {"type": "text", "text": "..."} 格式
                text = block.get("text", "")
                if isinstance(text, str) and text:
                    texts.append(text)
            elif isinstance(block, str) and block:
                texts.append(block)

    # 3. tool_calls args（AIMessage 才有）
    tool_calls = getattr(msg, 'tool_calls', None)
    if tool_calls and isinstance(tool_calls, list):
        for tc in tool_calls:
            args = None
            if isinstance(tc, dict):
                args = tc.get("args", {})
            elif hasattr(tc, 'args'):
                args = tc.args

            if isinstance(args, dict):
                for val in args.values():
                    if isinstance(val, str) and val:
                        texts.append(val)
            elif isinstance(args, str) and args:
                texts.append(args)

    return texts


def rebuild_content(original_content: Any, replacements: dict[str, str]) -> Any:
    """
    将替换映射应用到 content 上（支持 str 和 list-form）。

    Args:
        original_content: 原始 content（str 或 list）
        replacements: {原文: 替换文} 映射

    Returns:
        替换后的 content（类型与原始一致）
    """
    if isinstance(original_content, str):
        result = original_content
        for old, new in replacements.items():
            result = result.replace(old, new)
        return result
    elif isinstance(original_content, list):
        new_blocks = []
        for block in original_content:
            if isinstance(block, dict) and "text" in block:
                text = block["text"]
                for old, new in replacements.items():
                    text = text.replace(old, new)
                new_blocks.append({**block, "text": text})
            elif isinstance(block, str):
                text = block
                for old, new in replacements.items():
                    text = text.replace(old, new)
                new_blocks.append(text)
            else:
                new_blocks.append(block)
        return new_blocks
    return original_content


def rebuild_tool_calls(original_tool_calls: list, replacements: dict[str, str]) -> list:
    """
    将替换映射应用到 tool_calls 的 args 上。
    """
    if not original_tool_calls:
        return original_tool_calls

    new_calls = []
    for tc in original_tool_calls:
        if isinstance(tc, dict):
            args = tc.get("args", {})
            if isinstance(args, dict):
                new_args = {}
                for k, v in args.items():
                    if isinstance(v, str):
                        for old, new in replacements.items():
                            v = v.replace(old, new)
                    new_args[k] = v
                new_calls.append({**tc, "args": new_args})
            else:
                new_calls.append(tc)
        else:
            new_calls.append(tc)
    return new_calls
