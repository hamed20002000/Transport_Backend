import { Injectable } from '@nestjs/common';
import { ChatRequest, Tool } from 'src/agent/types';
import axios from "axios";
import { DataSource } from "typeorm";
import { InjectDataSource } from '@nestjs/typeorm';
import { AgentToolsService } from './agentTools.service';
import { ContextManager } from '../contextManager';
import { AgentGateway } from '../agent.gateway';




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
  
}