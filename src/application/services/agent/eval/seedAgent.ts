/**
 * بردار domainها و ابزارهای agent را از فایل‌های localFiles می‌سازد:
 *
 *   npm run agent:seed
 *
 * domain_embedding_docs.json -> "ToolDomain" (domainهای حذف‌شده از فایل پاک می‌شوند)
 * tool_embedding_docs.json   -> "EmbeddingTool" (کل جدول با فایل جایگزین می‌شود)
 *
 * قبلش با npm run agent:eval-domains توضیح‌ها را بسنجید. سرور در حال اجرا
 * حداکثر ظرف یک دقیقه index جدید domainها را می‌خواند.
 */
import { readFileSync } from 'node:fs';

import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { config } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';

import { typeOrmConfig } from 'src/infrastructure/database/typeorm-cli.config';
import { EMBEDDING_MODEL, EMBEDDING_URL } from '../domainRanking';
import { seedEmbeddingTools, seedToolDomains, ToolSeedDoc } from '../domainSeeding';
import { DOMAIN_DOCS_PATH, TOOL_DOCS_PATH } from '../services/embedding.service';
import { EmbeddingDomainTool } from '../types';

const embed = async (text: string): Promise<number[]> =>
  (await axios.post(EMBEDDING_URL, { model: EMBEDDING_MODEL, input: text })).data.embeddings[0];

async function main(): Promise<void> {
  config();
  const domains = JSON.parse(readFileSync(DOMAIN_DOCS_PATH, 'utf8')) as EmbeddingDomainTool[];
  const tools = JSON.parse(readFileSync(TOOL_DOCS_PATH, 'utf8')) as ToolSeedDoc[];

  const dataSource = new DataSource({
    ...(typeOrmConfig(new ConfigService()) as DataSourceOptions),
    entities: [],
    migrations: [],
    logging: false,
  });
  await dataSource.initialize();

  try {
    const seeded = await seedToolDomains(dataSource, domains, embed, { removeMissing: true });
    console.log(`domains upserted (${seeded.upserted.length}): ${seeded.upserted.join(', ')}`);
    console.log(`domains removed  (${seeded.removed.length}): ${seeded.removed.join(', ') || '-'}`);

    const written = await seedEmbeddingTools(dataSource, tools, embed, { replaceAll: true });
    console.log(`tools written    (${written.written.length}): ${written.written.join(', ')}`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
