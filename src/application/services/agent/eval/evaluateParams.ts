/**
 * ارزیابی گام سوم agent (استخراج پارامتر) با همان AgentToolsService.extractTools
 * واقعی. ابزار هر جمله از قبل معلوم است تا فقط همین گام سنجیده شود:
 *
 *   npm run agent:eval-params
 *
 * هر مقدار مورد انتظار باید درست استخراج شود؛ پارامتری که کاربر نگفته ولی مدل
 * مقدار داده «EXTRA» گزارش می‌شود (خطر نوشتن چیزی که کاربر نخواسته).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

import { typeOrmConfig } from 'src/infrastructure/database/typeorm-cli.config';
import { ToolRegister } from '../toolRegister';
import { AgentToolsService } from '../services/agentTools.service';

interface ParamCase {
  tool: string;
  text: string;
  expect: Record<string, unknown>;
}

// فقط تفاوت‌های نوشتاری که معنی را عوض نمی‌کنند یکسان می‌شوند
const norm = (value: unknown): string =>
  String(value)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌\s]+/g, ' ')
    .trim();

function same(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    const got = Array.isArray(actual) ? actual.map(norm).sort() : [];
    return JSON.stringify(expected.map(norm).sort()) === JSON.stringify(got);
  }
  // boolean گفته‌نشده یعنی false؛ handler هم پیش‌فرض false می‌گیرد
  if (typeof expected === 'boolean') return (actual === true || String(actual) === 'true') === expected;
  return norm(expected) === norm(actual ?? '');
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0);

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  config();
  const path = arg('prompts') ?? join(process.cwd(), 'src/application/services/agent/eval/param-eval-prompts.json');
  const cases = JSON.parse(readFileSync(resolve(path), 'utf8')) as ParamCase[];

  const dataSource = new DataSource({
    ...(typeOrmConfig(new ConfigService()) as DataSourceOptions),
    entities: [],
    migrations: [],
    logging: false,
  });
  await dataSource.initialize();
  const agentTools = new AgentToolsService(new ToolRegister(), dataSource);

  let exact = 0;
  let valuesOk = 0;
  let valuesTotal = 0;
  let extras = 0;
  try {
    for (const c of cases) {
      const extracted = await agentTools.extractTools(c.text, c.tool, '');
      const params: Record<string, unknown> = extracted?.parameters ?? {};
      const wrong = Object.entries(c.expect)
        .filter(([key, value]) => !same(value, params[key]))
        .map(([key, value]) => `${key}: expected ${JSON.stringify(value)} got ${JSON.stringify(params[key])}`);
      const extra = Object.entries(params)
        .filter(([key, value]) => !(key in c.expect) && !isEmpty(value))
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`);

      valuesTotal += Object.keys(c.expect).length;
      valuesOk += Object.keys(c.expect).length - wrong.length;
      extras += extra.length;
      if (!wrong.length && !extra.length) exact++;

      const status = wrong.length ? 'FAIL' : extra.length ? 'EXTRA' : 'OK  ';
      console.log(`${status} ${c.tool}\n     ${c.text}`);
      for (const w of wrong) console.log(`       ✗ ${w}`);
      if (extra.length) console.log(`       + ${extra.join(', ')}`);
    }
  } finally {
    await dataSource.destroy();
  }

  console.log('');
  console.log(`cases fully correct (no wrong, no extra) : ${exact}/${cases.length}`);
  console.log(`expected values extracted correctly     : ${valuesOk}/${valuesTotal}`);
  console.log(`extra values the user did not say       : ${extras}`);
  if (valuesOk < valuesTotal) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
