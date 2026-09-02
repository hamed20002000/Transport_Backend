import { Injectable } from "@nestjs/common";
import { ToolHandlerType } from "./types";

@Injectable()
export class ToolRegister {

    private toolHandlers = new Map<string, (params: any,) => Promise<any>|AsyncGenerator<any,any,any>>();

    public register(item: ToolHandlerType) {
        this.toolHandlers.set(
            item.functionName,
            item.handler
        );
    }

    public async execute(name: string, param: any) {
        const handler = this.toolHandlers.get(name);

        if (!handler) {
            throw new Error(`Tool ${name} not found`);
        }

        return handler(param);
    }
      normalizingName(name:string):string{

      return name.replace(/\brolü(nü|ne|ni|na|nun|nün|nın|nin)?\b/giu, "")
          .replace(/\brol\b/giu, "")
          .trim();
  }

     propIsExist(prop:string):boolean{
        if(prop!==""&&prop!=undefined) return true;
        return false
     }
}