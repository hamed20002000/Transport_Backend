import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import * as XLSX from 'xlsx';
import { TenderItem } from './entities/TenderItem'; // اسم و مسیر دقیقش رو با entity واقعی خودت هماهنگ کن



@Injectable()
export class TenderService {
    constructor(
        @InjectDataSource() private readonly dataSource: DataSource
    ) { }

}