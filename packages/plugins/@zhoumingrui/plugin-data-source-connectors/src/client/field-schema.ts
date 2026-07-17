/**
 * Copyright (c) 2026 Zhou Mingrui.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ISchema } from '@formily/json-schema';
import { tExpr } from './locale';

export function createVariableInputField(
  title: string,
  options: { required?: boolean; password?: boolean; number?: boolean } = {},
): ISchema {
  const constantType = options.number ? 'number' : 'string';
  return {
    type: constantType,
    title: tExpr(title),
    required: options.required,
    'x-decorator': 'FormItem',
    'x-component': 'TextAreaWithGlobalScope',
    'x-component-props': {
      input: !options.password,
      password: options.password,
      number: options.number,
      expression: false,
      nullable: false,
      useTypedConstant: [constantType],
    },
  };
}
