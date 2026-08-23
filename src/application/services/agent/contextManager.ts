import { Injectable } from "@nestjs/common";
import { ContextInfo } from "./types";

@Injectable()
export class ContextManager {
      constructor(
      ) {
          this.history=new Map<string,ContextInfo[]>();
      }

       history:Map<string,ContextInfo[]>;
       
       public  addNewHistory(item:ContextInfo,userId:string){
           
              if(item.result){
                const currentHistory=this.history.get(userId)??[];
                if(currentHistory.length>=5){
                     currentHistory.splice(0,1)
                }
                currentHistory.push(item);
                this.history.set(userId,currentHistory);
              }
       }
      public  getHistory(start:number=0,userId:string,end?:number,type:"string"|"object"="string"){
        const currentHistory=this.history.get(userId)??[];
        let str="";
           
              if(end){
                  if(type=="string"){
                    currentHistory.slice(start,end).forEach(function(item,index){
                           str+=JSON.stringify(item);
                    })
                    return str
                }
                
                  return currentHistory.slice(start,end)
              }
              else{
                if(type=="string"){
                    currentHistory.slice(start).forEach(function(item,index){
                           str+=JSON.stringify(item);
                    })
                    return str
                }
                return currentHistory.slice(start)
              }
       }

       public getParams(params:any):Record<string,string>{
              const obj={};
            
                for(let prop in params){
                     if(prop!="req"&&prop!="files"){
                            obj[prop]=params[prop].toString()
                     }
                }
                return obj;
       }
       public frequencyError(userId:string):boolean{

           const currentHistory=this.history.get(userId)??[];

              let errorCount=0;
              for(let i=0;i<currentHistory.length;i++){
                     if(currentHistory[i].status=="fault"){
                            errorCount++;
                            if(errorCount>3) return true;
                     }
                     else{
                            errorCount=0
                     }
              }
              return false

       }

       public getPreviousDomain(userId:string):string{
                   const currentHistory=this.history.get(userId)??[];
                   if(currentHistory.length==0)  return undefined;
                   currentHistory[currentHistory.length-1].domain

       }

          public getPreviousTool(userId:string):string{
                   const currentHistory=this.history.get(userId)??[];
                   if(currentHistory.length==0)  return undefined;
                  return currentHistory[currentHistory.length-1].operation

       }

       

       
}