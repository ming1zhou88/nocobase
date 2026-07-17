/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { createVariableInputField } from '../field-schema';

describe('legacy connector input schema', () => {
  it('renders text constants as editable inputs while retaining variable selection', () => {
    const schema = createVariableInputField('Host', { required: true });

    expect(schema).toMatchObject({
      type: 'string',
      required: true,
      'x-component': 'TextAreaWithGlobalScope',
      'x-component-props': {
        input: true,
        nullable: false,
        useTypedConstant: ['string'],
      },
    });
  });

  it('renders numeric constants for ports and timeouts', () => {
    const schema = createVariableInputField('Port', { number: true });

    expect(schema).toMatchObject({
      type: 'number',
      'x-component-props': {
        number: true,
        useTypedConstant: ['number'],
      },
    });
  });

  it('keeps password values masked while allowing string constants', () => {
    const schema = createVariableInputField('Password', { password: true });

    expect(schema).toMatchObject({
      'x-component-props': {
        input: false,
        password: true,
        useTypedConstant: ['string'],
      },
    });
  });
});
