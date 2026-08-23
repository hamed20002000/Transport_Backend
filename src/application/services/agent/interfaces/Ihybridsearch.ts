export interface DenseDomainResult {
    DomainName: string;
    distance: number;
}

export interface LexicalDomainResult {
    DomainName: string;
    rank: number;
}

export interface LexemeStat {
    word: string;
    ndoc: number;
}

export interface DomainLexemeEntry {
    domainName: string;
    lexeme: string;
    tf: number; // تعداد تکرار این lexeme داخل SearchVector این domain
}