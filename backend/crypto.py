"""
BlindVault 加密模块

使用 AES-256-GCM（AEAD）对 secret 进行加解密。
- 每次加密使用随机 96-bit nonce
- 输出格式：base64(nonce + ciphertext + tag)
- 不允许在任何日志中打印明文或密文
"""

from __future__ import annotations

import base64
import logging

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

logger = logging.getLogger(__name__)

# Nonce 长度（96 bits = 12 bytes，GCM 标准推荐）
_NONCE_LENGTH = 12


def encrypt(plaintext: str, key: bytes) -> str:
    """
    AES-256-GCM 加密。

    Args:
        plaintext: 待加密的明文字符串
        key: 32 字节 AES-256 密钥

    Returns:
        base64 编码的密文字符串（nonce + ciphertext + tag）
    """
    if len(key) != 32:
        raise ValueError("AES-256 密钥必须为 32 字节")

    aesgcm = AESGCM(key)
    # 每次加密使用唯一随机 nonce
    import os

    nonce = os.urandom(_NONCE_LENGTH)
    plaintext_bytes = plaintext.encode("utf-8")
    # GCM 模式：encrypt 返回 ciphertext + tag（16 bytes）
    ciphertext_with_tag = aesgcm.encrypt(nonce, plaintext_bytes, None)
    # 组合：nonce + ciphertext + tag
    combined = nonce + ciphertext_with_tag
    return base64.urlsafe_b64encode(combined).decode("ascii")


def decrypt(ciphertext_b64: str, key: bytes) -> str:
    """
    AES-256-GCM 解密。

    Args:
        ciphertext_b64: base64 编码的密文（nonce + ciphertext + tag）
        key: 32 字节 AES-256 密钥

    Returns:
        解密后的明文字符串

    Raises:
        cryptography.exceptions.InvalidTag: 密钥错误或密文被篡改
    """
    if len(key) != 32:
        raise ValueError("AES-256 密钥必须为 32 字节")

    combined = base64.urlsafe_b64decode(ciphertext_b64)
    if len(combined) < _NONCE_LENGTH + 16:  # nonce + 最小 tag 长度
        raise ValueError("密文格式无效：数据长度不足")

    nonce = combined[:_NONCE_LENGTH]
    ciphertext_with_tag = combined[_NONCE_LENGTH:]

    aesgcm = AESGCM(key)
    plaintext_bytes = aesgcm.decrypt(nonce, ciphertext_with_tag, None)
    return plaintext_bytes.decode("utf-8")
