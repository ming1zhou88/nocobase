/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AesEncryptor } from '@nocobase/server';
import { describe, expect, it } from 'vitest';
import { CredentialCipherService } from '../services/credential-cipher.service';

function createCipher(): CredentialCipherService {
  return new CredentialCipherService(new AesEncryptor(Buffer.alloc(32, 17)));
}

describe('CredentialCipherService', () => {
  it('encrypts and decrypts a mailbox password', async () => {
    const cipher = createCipher();
    const encrypted = await cipher.encrypt('mail-password-123');

    expect(encrypted).not.toContain('mail-password-123');
    await expect(cipher.decrypt(encrypted)).resolves.toBe('mail-password-123');
  });

  it('uses a new data key and IV for each encryption', async () => {
    const cipher = createCipher();

    await expect(cipher.encrypt('same-password')).resolves.not.toBe(await cipher.encrypt('same-password'));
  });

  it('rejects a tampered credential', async () => {
    const cipher = createCipher();
    const encrypted = await cipher.encrypt('mail-password-123');
    const replacement = encrypted.endsWith('A') ? 'B' : 'A';
    const tampered = `${encrypted.slice(0, -1)}${replacement}`;

    await expect(cipher.decrypt(tampered)).rejects.toThrow(
      'Stored mailbox credential is invalid or cannot be decrypted',
    );
  });

  it('rejects plaintext or an unsupported credential format', async () => {
    const cipher = createCipher();

    await expect(cipher.decrypt('plain-password')).rejects.toThrow(
      'Stored mailbox credential is invalid or cannot be decrypted',
    );
  });
});
