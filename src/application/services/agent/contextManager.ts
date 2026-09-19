import { Injectable } from "@nestjs/common";
import { ContextInfo } from "./types";

@Injectable()
export class ContextManager {
    constructor() {
        this.history = new Map<string, ContextInfo[]>();
    }

    history: Map<string, ContextInfo[]>;

    /**
     * کلید ترکیبی می‌سازه -- این تنها جاییه که فرمت کلید تعریف می‌شه،
     * تا همه‌ی متدها دقیقاً یک روش یکسان استفاده کنن و هیچ‌جا اشتباهی
     * فقط sessionId (بدون username) به‌عنوان کلید استفاده نشه.
     */
    private buildKey(username: string, sessionId: string): string {
        return `${username}:${sessionId}`;
    }

    public hasSession(username: string, sessionId: string): boolean {
        return this.history.has(this.buildKey(username, sessionId));
    }

    public hydrate(username: string, sessionId: string, items: ContextInfo[]): void {
        const key = this.buildKey(username, sessionId);
        if (!this.history.has(key)) {
            this.history.set(key, items.slice(-5));
        }
    }

    public addNewHistory(item: ContextInfo, username: string, sessionId: string) {
        if (item.result) {
            const key = this.buildKey(username, sessionId);
            const currentHistory = this.history.get(key) ?? [];
            if (currentHistory.length >= 5) {
                currentHistory.splice(0, 1)
            }
            currentHistory.push(item);
            this.history.set(key, currentHistory);
        }
    }

    public getHistory(start: number = 0, username: string, sessionId: string, end?: number, type: "string" | "object" = "string") {
        const currentHistory = this.history.get(this.buildKey(username, sessionId)) ?? [];
        let str = "";
        if (end) {
            if (type == "string") {
                currentHistory.slice(start, end).forEach(function (item, index) {
                    str += JSON.stringify(item);
                })
                return str
            }
            return currentHistory.slice(start, end)
        }
        else {
            if (type == "string") {
                currentHistory.slice(start).forEach(function (item, index) {
                    str += JSON.stringify(item);
                })
                return str
            }
            return currentHistory.slice(start)
        }
    }

    public getParams(
  params: Record<string, unknown>,
): Record<string, string> {
  const obj: Record<string, string> = {};

  for (const prop in params) {
    if (prop === 'req' || prop === 'files') {
      continue;
    }

    const value = params[prop];

    if (value !== null && value !== undefined) {
      obj[prop] = String(value);
    }
  }

  return obj;
}

    public frequencyError(username: string, sessionId: string): boolean {
        const currentHistory = this.history.get(this.buildKey(username, sessionId)) ?? [];

        let errorCount = 0;
        for (let i = 0; i < currentHistory.length; i++) {
            if (currentHistory[i].status == "fault") {
                errorCount++;
                if (errorCount > 3) return true;
            }
            else {
                errorCount = 0
            }
        }
        return false
    }

    public getPreviousTool(username: string, sessionId: string): string|undefined {
        const currentHistory = this.history.get(this.buildKey(username, sessionId)) ?? [];
        if (currentHistory.length == 0) return undefined;
        return currentHistory[currentHistory.length - 1].operation
    }
}