/**
 * ارزیابی توضیح domainها (domain_embedding_docs.json) قبل از ساختن بردارها:
 *
 *   npm run agent:eval-domains
 *   npm run agent:eval-domains -- --docs path/to/docs.json --prompts path/to/prompts.json --min-accuracy 0.9
 *   npm run agent:eval-domains -- --role COMPANY     (فقط جمله‌های یک نقش)
 *
 * embedding با همان Ollama/bge-m3 و شکستن کلمه‌ها با همان Postgres زمان اجرا
 * انجام می‌شود؛ به دیتابیس چیزی نوشته نمی‌شود. اگر دقت انتخاب اول کمتر از
 * --min-accuracy (پیش‌فرض 1) باشد با کد 1 خارج می‌شود.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { config } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

import { typeOrmConfig } from 'src/infrastructure/database/typeorm-cli.config';
import { DOMAIN_TEXT_SEARCH_CONFIG, EMBEDDING_MODEL, EMBEDDING_URL } from '../domainRanking';
import { DomainDoc, EvalPrompt, evaluateDomains, formatReport } from './domainEvaluation';

const AGENT_DIR = join(process.cwd(), 'src/application/services/agent');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as T;
}

async function main(): Promise<void> {
  config();
  const docsPath = arg('docs') ?? join(AGENT_DIR, 'localFiles/domain_embedding_docs.json');
  const promptsPath = arg('prompts') ?? join(AGENT_DIR, 'eval/domain-eval-prompts.json');
  const minAccuracy = Number(arg('min-accuracy') ?? 1);

  const docs = readJson<DomainDoc[]>(docsPath);
  const role = arg('role');
  const prompts = readJson<EvalPrompt[]>(promptsPath).filter((p) => !role || p.role === role);
  console.log(`docs   : ${docsPath} (${docs.length} domains)\nprompts: ${promptsPath} (${prompts.length})\n`);

  // فقط برای to_tsvector؛ entity و migration لازم نیست
  const dataSource = new DataSource({
    ...(typeOrmConfig(new ConfigService()) as DataSourceOptions),
    entities: [],
    migrations: [],
    logging: false,
  });
  await dataSource.initialize();

  try {
    const report = await evaluateDomains(docs, prompts, {
      embed: async (texts) =>
        (await axios.post(EMBEDDING_URL, { model: EMBEDDING_MODEL, input: texts })).data.embeddings,
      lexemes: async (text) =>
        (
          await dataSource.query(
            // هر lexeme به تعداد تکرارش (cardinality(positions)) برمی‌گردد، همان tf که
            // CondinateService.refreshIndex از "SearchVector" می‌خواند
            `SELECT t.lexeme FROM unnest(to_tsvector($2::regconfig, $1)) AS t(lexeme, positions, weights),
                    generate_series(1, cardinality(t.positions));`,
            [text, DOMAIN_TEXT_SEARCH_CONFIG],
          )
        ).map((row: { lexeme: string }) => row.lexeme),
    });

    console.log(formatReport(report));
    if (report.accuracy < minAccuracy) process.exitCode = 1;
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
