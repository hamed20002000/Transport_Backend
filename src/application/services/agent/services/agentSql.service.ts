import { Injectable } from '@nestjs/common';
import { ChatRequest, Tool } from 'src/agent/types';
import axios from "axios";
import { DataSource } from "typeorm";
import { InjectDataSource } from '@nestjs/typeorm';
import tables from 'src/agent/tables.json';
import schema from 'src/application/services/agent/schema.json';



@Injectable()
export class AgentSqlService {
    constructor(
        @InjectDataSource() private readonly dataSource: DataSource,
    ) {

    }

    async runPrompt(prompt: string, systemContent: string): Promise<string> {
        const ollamareq: ChatRequest = {
            model: "qwen3:8b",
            messages: [
                {
                    role: 'system',
                    content: systemContent
                },
                {
                    role: "user",
                    content: prompt
                }],
            stream: false,
            options: {
                temperature: 0,
                top_p: 0.9,
                repeat_penalty: 1.1
            }

        }


        const resp = await axios.post(
            "http://localhost:11434/api/chat",
            JSON.stringify({
                ...ollamareq, format: {
                    "type": "object",
                    "properties": {
                        "sql": {
                            "type": "string"
                        },
                        "error": {
                            "type": "string"
                        },
                        "fields": {
                            "type": "array",
                            "items": {
                                "type": "string"
                            }
                        }
                    }
                }
            }),

            {
                headers: {
                    "Content-Type": "application/json",
                },
            },
        );


        return resp.data.message.content;

    }
    async executeQuery(text: string): Promise<void> {

        this.dataSource.query(text);
    }
     async extractSchema(prompt: string): Promise<string> {
    
    
    
            const systemRules = `You are a database table selection agent.
    
    Your ONLY task is to select required database tables.
    
    Rules:
    - Use ONLY tables from the provided catalog.
    - Never explain your answer.
    - Never generate SQL.
    - Never show reasoning.
    - Return ONLY JSON.
    - The response must start with { and end with }.
    
    Output format:
    
    {
      "tables": ["TableName"]
    }`
    
    
            prompt = `
    Table catalog:
    
    ${JSON.stringify(tables, null, 2)}
    
    Request:
    ${prompt}`;
    
    
    
            const ollamareq: ChatRequest = {
                model: "qwen3:8b",
                messages: [
                    {
                        role: 'system',
                        content: systemRules
                    },
                    {
                        role: "user",
                        content: prompt
                    }],
                stream: false,
    
            }
    
    
            const resp = await axios.post(
                "http://localhost:11434/api/chat",
                JSON.stringify({
                    ...ollamareq, format: {
                        type: "object",
                        properties: {
                            tables: {
                                type: "array",
                                items: {
                                    type: "string"
                                }
                            }
                        },
                        required: ["tables"]
                    }
                }),
    
                {
                    headers: {
                        "Content-Type": "application/json",
                    },
                },
            );
            const tablesResponse = JSON.parse(resp.data.message.content)?.tables || [];
            const selectedTables = [];
            for (const tableName of tablesResponse) {
                const table = schema.tables.find(t => t.name === tableName);
                if (table) {
                    selectedTables.push(table);
                }
            }
    
            return JSON.stringify(selectedTables, null, 2);
        }
  
}