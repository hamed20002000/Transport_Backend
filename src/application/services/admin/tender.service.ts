import { forwardRef, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { SystemOperations } from 'src/domain/entities/SystemOperations';
import { SystemOperationRepository } from 'src/infrastructure/repositories/admin/system-operation.repository';
import { ItemUnits } from 'src/domain/entities/ItemUnits';
import { ItemUnitRepository } from 'src/infrastructure/repositories/admin/item-unit.repository';
import { TenderHeaders } from 'src/domain/entities/TenderHeaders';
import { TenderRepository } from 'src/infrastructure/repositories/admin/tender.repository';
import { CreateTenderDto, TenderListDto, UpdateTenderDto, UpdateTenderHeaderDto } from 'src/presentation/dtos/initial-operations/tender-dto';
import { ToolRegister } from '../agent/toolRegister';
import { UserService } from '../user/user.service';
import { ContextManager } from '../agent/contextManager';
import { RequestResult } from '../agent/types';
import messages from '../agent/localFiles/messages.json';
import { UsernameSpecification } from 'src/application/specifications/user/user-specifications';
import { tenderStatus } from 'src/domain/enums/tenderstatus.enum';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { TenderCategories } from 'src/domain/entities/TenderCategories';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as XLSX from 'xlsx';


@Injectable()
export class TenderService extends BaseService<TenderHeaders> {
  constructor(

    private readonly tenderRepository: TenderRepository,
      private readonly toolRegister: ToolRegister,
        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,
        private readonly history: ContextManager,

        @InjectDataSource() private readonly dataSource: DataSource
  ) {
    super(tenderRepository);
  }



  onModuleInit() {
    this.toolRegister.register({
      functionName: "create_tender",
      handler: async (param: any): Promise<RequestResult> => {

        if (param.title == undefined || param.title.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "create_tender",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.tender.nameisrequired
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.tender.nameisrequired, HttpStatus.BAD_REQUEST);
        }
        const user = param.req.user;
        const user_specification = new UsernameSpecification(user.username);

        const tender=new TenderHeaders();
        tender.title=this.toolRegister.normalizingName(param.title).trim()
        tender.attachments=null;
        tender.createAt=new Date();
        tender.recordStatus=recordStatus.Active;

        const [checkUser] = await this.userService.getWithSpecification(
          user_specification,
          null,
          { id: true }
        );

        const createdTender = await this.tenderRepository.add(tender);
          this.history.addNewHistory({
            status: "success",
            operation: "create_tender",
            parameters: this.history.getParams(param),
            result: {
              id: createdTender.id.toString(),
              title:createdTender.title
            }
          }, param.req.user.username,param.sessionId)

        return {
          continuePrompt:"Ayrıntı eklemek için yöntemlerden birini seçin.",
          toolName: "create_tender"
        }



      }
    })

  //   this.toolRegister.register({
  //     functionName: "update_force_major",
  //     handler: async (param: any): Promise<RequestResult> => {
  //       if (param.title == undefined || param.title.replaceAll(" ", "") == "") {
  //         this.history.addNewHistory({
  //           status: "fault",
  //           operation: "update_force_major",
  //           parameters: this.history.getParams(param),
  //           result: {
  //             errorMessage: messages.supplier.nameisrequired
  //           }
  //         }, param.req.user.username)

  //         throw new HttpException(messages.supplier.nameisrequired, HttpStatus.BAD_REQUEST);
  //       }
  //       const forceMajorname = this.toolRegister.normalizingName(param.title).trim();
  //       const forceMajornewname = this.toolRegister.normalizingName(param.newtitle).trim();
  //       var checkForceMajor = await this.forceMajorsRepository.findByName(forceMajorname);

  //       if (!checkForceMajor) {
  //         this.history.addNewHistory({
  //           status: "fault",
  //           operation: "update_force_major",
  //           parameters: this.history.getParams(param),
  //           result: {
  //             errorMessage: messages.forceMajor.notfound
  //           }
  //         }, param.req.user.username)

  //         throw new HttpException(messages.forceMajor.notfound, HttpStatus.NOT_FOUND);
  //       }
  //       checkForceMajor.title = forceMajornewname ?? checkForceMajor.title;


  //       var updateForceMajor = await this.update(checkForceMajor);

  //       this.history.addNewHistory({
  //         status: "success",
  //         operation: "update_force_major",
  //         parameters: this.history.getParams(param),
  //         result: {
  //           "id": updateForceMajor.id.toString(),
  //           "title": updateForceMajor.title,
  //         }
  //       }, param.req.user.username)

  //       return {
  //         continuePrompt: undefined,
  //         toolName: "update_force_major"
  //       }
  //     }
  //   })

  //   this.toolRegister.register({
  //     functionName: "delete_force_major",
  //     handler: async (param: any): Promise<RequestResult> => {

  //       if (param.title == undefined || param.title.replaceAll(" ", "") == "") {
  //         this.history.addNewHistory({
  //           status: "fault",
  //           operation: "delete_force_major",
  //           parameters: this.history.getParams(param),
  //           result: {
  //             errorMessage: messages.forceMajor.nameisrequired
  //           }
  //         }, param.req.user.username)
  //         throw new HttpException(messages.forceMajor.nameisrequired, HttpStatus.BAD_REQUEST);
  //       }

  //       const deleteForcemajorName = this.toolRegister.normalizingName(param.title);

  //       var deleteSupplier = await this.forceMajorsRepository.findByName(deleteForcemajorName.trim());
  //       if (deleteSupplier == null) {
  //         this.history.addNewHistory({
  //           status: "fault",
  //           operation: "delete_force_major",
  //           parameters: this.history.getParams(param),
  //           result: {
  //             errorMessage: messages.forceMajor.notfound
  //           }
  //         }, param.req.user.username)
  //         throw new HttpException(messages.forceMajor.notfound, HttpStatus.BAD_REQUEST);
  //       }

  //       var deleteProduct = await this.delete(deleteSupplier.id);
  //       this.history.addNewHistory({
  //         status: "success",
  //         operation: "delete_force_major",
  //         parameters: this.history.getParams(param),
  //         result: {
  //           "id": deleteSupplier.id.toString(),
  //           "title": deleteForcemajorName,
  //         }
  //       }, param.req.user.username)


  //       return {
  //         continuePrompt: undefined,
  //         toolName: "delete_force_major"
  //       };
  //     }
  //   })

  //   this.toolRegister.register({
  //     functionName: "update_force_major_record_status",
  //     handler: async (param: any): Promise<RequestResult> => {
  //       if (param.title == undefined || param.title.replaceAll(" ", "") == "") {
  //         this.history.addNewHistory({
  //           status: "fault",
  //           operation: "update_force_major",
  //           parameters: this.history.getParams(param),
  //           result: {
  //             errorMessage: messages.supplier.nameisrequired
  //           }
  //         }, param.req.user.username)

  //         throw new HttpException(messages.supplier.nameisrequired, HttpStatus.BAD_REQUEST);
  //       }
  //       const forceMajorname = this.toolRegister.normalizingName(param.title).trim();
  //       var checkForceMajor = await this.forceMajorsRepository.findByName(forceMajorname);

  //       if (!checkForceMajor) {
  //         this.history.addNewHistory({
  //           status: "fault",
  //           operation: "update_force_major_record_status",
  //           parameters: this.history.getParams(param),
  //           result: {
  //             errorMessage: messages.forceMajor.notfound
  //           }
  //         }, param.req.user.username)

  //         throw new HttpException(messages.forceMajor.notfound, HttpStatus.NOT_FOUND);
  //       }
  //       checkForceMajor.recordStatus = param.recordstatus ?? checkForceMajor.recordStatus;


  //       var updateForceMajor = await this.update(checkForceMajor);

  //       this.history.addNewHistory({
  //         status: "success",
  //         operation: "update_force_major_record_status",
  //         parameters: this.history.getParams(param),
  //         result: {
  //           "id": updateForceMajor.id.toString(),
  //           "title": updateForceMajor.title,
  //         }
  //       }, param.req.user.username)

  //       return {
  //         continuePrompt: undefined,
  //         toolName: "update_force_major_record_status"
  //       }
  //     }
  //   })


   }



  async getAllTenders(): Promise<TenderHeaders[]> {
    return this.tenderRepository.getAllTenders();
  }

  async getTenderById(id: number): Promise<TenderHeaders> {
    return this.tenderRepository.getTenderById(id);
  }

  async updateTenderHeader(tenderDto: UpdateTenderHeaderDto): Promise<void> {
    return this.tenderRepository.updateTenderHeader(tenderDto);
  }
  async updateTender(tenderDto: UpdateTenderDto): Promise<void> {
    return this.tenderRepository.updateTender(tenderDto);
  }

 
    async importFromExcel(file: Express.Multer.File, tenderId: string): Promise<{ count: number }> {
        const workbook = XLSX.readFile(file.path);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // چون هدر سه‌سطری و merge شده‌ست، به‌جای sheet_to_json،
        // مستقیم به‌شکل آرایه‌ی خام (بدون تفسیر هدر) می‌خونیم
        const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
            header: 1, // یعنی هر ردیف یک آرایه‌ی ساده از سلول‌هاست، نه object
            defval: null,
        });

        const parsedRows: ParsedTenderRow[] = [];

        // داده‌ها از ردیف ۵ (index 4، چون صفر-پایه‌ست) شروع می‌شن
        for (let i = 4; i < rawRows.length; i++) {
            const row = rawRows[i];

            if (!row) continue;

            const firstCell = String(row[0] ?? "").trim();

            // به محض رسیدن به "ALT TOPLAM" یا "TOPLAM KEŞİF"، یعنی
            // بخش داده‌ها تموم شده -- دیگه حلقه رو متوقف کن
            if (firstCell.includes("ALT TOPLAM") || firstCell.includes("TOPLAM KEŞİF")) {
                break;
            }

            // اگه هم شرح کالا (ستون E) هم واحد (ستون F) خالی بودن،
            // احتمالاً این یک ردیف خالی/تزئینیه، ردش کن
            const description = row[4];
            const unit = row[5];
            if (!description && !unit) continue;

            parsedRows.push({
                oldCode: row[0] ?? null,
                newCode: row[1] ?? null,
                description: description ?? null,
                unit: unit ?? null,
                materialQty: row[7] != null ? Number(row[7]) : null,
                installQty: row[8] != null ? Number(row[8]) : null,
                removeQty: row[9] != null ? Number(row[9]) : null,
                dmmQty: row[10] != null ? Number(row[10]) : null,
                materialPrice: row[11] != null ? Number(row[11]) : null,
                installPrice: row[12] != null ? Number(row[12]) : null,
                removePrice: row[13] != null ? Number(row[13]) : null,
            });
        }

        const items = parsedRows.map((r) => ({
            TenderId: tenderId,
            OldCode: r.oldCode,
            NewCode: r.newCode,
            Description: r.description,
            Unit: r.unit,
            MaterialQty: r.materialQty,
            InstallQty: r.installQty,
            RemoveQty: r.removeQty,
            DmmQty: r.dmmQty,
            MaterialPrice: r.materialPrice,
            InstallPrice: r.installPrice,
            RemovePrice: r.removePrice,
        }));

       // await this.dataSource.getRepository(TenderItem).insert(items);

        return { count: items.length };
    }

}