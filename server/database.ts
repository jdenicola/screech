import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

export interface Database {
  query(sql:string, values?:unknown[]): Promise<{rows:any[]; rowCount?:number}>;
  end():Promise<void>;
}

export function openDatabase(filename=process.env.SQLITE_PATH??'data/screech.sqlite'):Database {
  if(filename!==':memory:')mkdirSync(dirname(resolve(filename)),{recursive:true});
  const sqlite=new DatabaseSync(filename);
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  return {
    async query(sql,values=[]) {
      if(sql.startsWith('CREATE TABLE')){sqlite.exec(sql);return {rows:[]};}
      const bindings:SQLInputValue[]=[];
      const statement=sqlite.prepare(sql.replace(/\$(\d+)/g,(_match,index)=>{
        const value=values[Number(index)-1];
        bindings.push(typeof value==='boolean'?Number(value):value!==null&&typeof value==='object'?JSON.stringify(value):value as SQLInputValue);
        return '?';
      }));
      if(!statement.columns().length)return {rows:[],rowCount:Number(statement.run(...bindings).changes)};
      const rows=statement.all(...bindings).map(row=>({...row,...(typeof row.config==='string'?{config:JSON.parse(row.config)}:{})}));
      return {rows,rowCount:rows.length};
    },
    async end(){sqlite.close();}
  };
}
