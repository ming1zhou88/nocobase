/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const FORMAT_VERSION = 'mail-center-v1';
const INVALID_CREDENTIAL_ERROR = 'Stored mailbox credential is invalid or cannot be decrypted';

interface KeyEncryptor {
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
}

export class CredentialCipherService {
  constructor(private readonly keyEncryptor: KeyEncryptor) {}

  async encrypt(value: string): Promise<string> {
    const dataKey = randomBytes(32);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const wrappedKey = await this.keyEncryptor.encrypt(dataKey.toString('base64'));

    return [
      FORMAT_VERSION,
      wrappedKey,
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  async decrypt(value: string): Promise<string> {
    try {
      const [version, wrappedKey, encodedIv, encodedAuthTag, encodedValue, ...unexpected] = value.split(':');
      if (
        version !== FORMAT_VERSION ||
        !wrappedKey ||
        !encodedIv ||
        !encodedAuthTag ||
        encodedValue === undefined ||
        unexpected.length > 0
      ) {
        throw new Error(INVALID_CREDENTIAL_ERROR);
      }

      const dataKey = Buffer.from(await this.keyEncryptor.decrypt(wrappedKey), 'base64');
      const iv = Buffer.from(encodedIv, 'base64');
      const authTag = Buffer.from(encodedAuthTag, 'base64');
      if (dataKey.length !== 32 || iv.length !== 12 || authTag.length !== 16) {
        throw new Error(INVALID_CREDENTIAL_ERROR);
      }

      const decipher = createDecipheriv('aes-256-gcm', dataKey, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(Buffer.from(encodedValue, 'base64')), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      throw new Error(INVALID_CREDENTIAL_ERROR);
    }
  }
}
