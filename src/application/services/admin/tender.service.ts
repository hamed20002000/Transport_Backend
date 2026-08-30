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

import { join } from 'path';
import { Users } from 'src/domain/entities/Users';
import { head } from 'node_modules/axios/index.cjs';
import { TenderDetails } from 'src/domain/entities/TenderDetails';
import { Items } from 'src/domain/entities/Items';
import { ItemService } from './item.service';
import { CategoryService } from './category.service';
import { CategorySpecification } from 'src/application/specifications/admin/category-specifications';
import { Categories } from 'src/domain/entities/Categories';
import { ItemUnitService } from './item-unit.service';


@Injectable()
export class TenderService extends BaseService<TenderHeaders> {
  constructor(

    private readonly tenderRepository: TenderRepository,
    private readonly toolRegister: ToolRegister,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
    private readonly history: ContextManager,
    private readonly itemService: ItemService,
    private readonly categoryService: CategoryService,
    private readonly unitService: ItemUnitService,

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
          }, param.req.user.username, param.sessionId)
          throw new HttpException(messages.tender.nameisrequired, HttpStatus.BAD_REQUEST);
        }
        const user = param.req.user;
        const user_specification = new UsernameSpecification(user.username);
        const [checkUser] = await this.userService.getWithSpecification(
          user_specification,
          null,
          { id: true }
        );

        const tender = new TenderHeaders();
        tender.title = this.toolRegister.normalizingName(param.title).trim()
        tender.attachments = null;
        tender.createAt = new Date();
        tender.recordStatus = recordStatus.Active;
        tender.status = tenderStatus.Pending;
        tender.user = checkUser;



        const createdTender = await this.tenderRepository.add(tender);
        this.history.addNewHistory({
          status: "success",
          operation: "create_tender",
          parameters: this.history.getParams(param),
          result: {
            id: createdTender.id.toString(),
            title: createdTender.title
          }
        }, param.req.user.username, param.sessionId)

        return {
          continuePrompt: "Ayrıntı eklemek için yöntemlerden birini seçin.",
          toolName: "create_tender"
        }



      }
    })

    this.toolRegister.register({
      functionName: "update_tender",
      handler: async (param: any): Promise<RequestResult> => {
        if (param.title == undefined || param.title.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_tender",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.tender.nameisrequired
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(messages.tender.nameisrequired, HttpStatus.BAD_REQUEST);
        }
        const tendername = this.toolRegister.normalizingName(param.title).trim();
        const tendernewname = param.newtitle
          ? this.toolRegister.normalizingName(param.newtitle).trim()
          : undefined;
        var checkTenderHeader = await this.tenderRepository.getTenderByTitle(tendername);

        if (checkTenderHeader.length < 1) {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_tender",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.tender.notfound
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(messages.tender.notfound, HttpStatus.NOT_FOUND);
        }
        checkTenderHeader[0].title = tendername ?? checkTenderHeader[0].title;

        if (param.files && param.files.length > 0) {
          const user = param.req.user;
          const user_specification = new UsernameSpecification(user.username);

          const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
          );
          await this.importFromExcel(param.files[0], checkTenderHeader[0].id, checkTenderHeader[0], checkUser, param)
        }

        checkTenderHeader[0].title = tendernewname ?? tendername;
        var updateForceMajor = await this.update(checkTenderHeader[0]);

        const malzemeTotal = this.calculateTotal(updateForceMajor.tenderCategories, "firmProcuredItemQuantities", "firmProcuredItemPrice");
        const montajTotal = this.calculateTotal(updateForceMajor.tenderCategories, "ourProcuredItemQuantities", "montajPrice");
        const demontajTotal = this.calculateTotal(updateForceMajor.tenderCategories, "demontaj", "demontajPrice");
        const dmmTotal = this.calculateTotal(updateForceMajor.tenderCategories, "demontajMontaj", "demontajMontajPrice");

        const grandTotal = malzemeTotal + montajTotal + demontajTotal + dmmTotal

      

        this.history.addNewHistory({
          status: "success",
          operation: "update_tender",

          parameters: this.history.getParams(param),
          result: {
            "id": updateForceMajor.id.toString(),
            "title": updateForceMajor.title,
          }
        }, param.req.user.username, param.sessionId)

        return {
          continuePrompt: `MALZEME TUTARI-TL Toplamı:${malzemeTotal} MONTAJ TUTARI-TL Toplamı:${montajTotal} DEMONTAJ TUTARI-TL Toplamı:${demontajTotal}
DMM TUTARI-TL Toplamı:${dmmTotal} TOPLAM KEŞİF BEDELİ TL:${grandTotal}`,
          toolName: "update_tender"
        }
      }
    })

    this.toolRegister.register({
      functionName: "delete_tender",
      handler: async (param: any): Promise<RequestResult> => {

        if (param.title == undefined || param.title.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "delete_tender",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.tender.nameisrequired
            }
          }, param.req.user.username, param.sessionId)
          throw new HttpException(messages.tender.nameisrequired, HttpStatus.BAD_REQUEST);
        }

        const tenderName = this.toolRegister.normalizingName(param.title);

        var deleteTender = await this.tenderRepository.getTenderByTitle(tenderName.trim());
        if (deleteTender == null || deleteTender.length < 1) {
          this.history.addNewHistory({
            status: "fault",
            operation: "delete_force_major",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.tender.notfound
            }
          }, param.req.user.username, param.sessionId)
          throw new HttpException(messages.tender.notfound, HttpStatus.BAD_REQUEST);
        }

        var deletedTender = await this.delete(deleteTender[0].id);
        this.history.addNewHistory({
          status: "success",
          operation: "delete_force_major",
          parameters: this.history.getParams(param),
          result: {
            "id": deleteTender[0].id.toString(),
            "title": tenderName,
          }
        }, param.req.user.username, param.sessionId)


        return {
          continuePrompt: undefined,
          toolName: "delete_tender"
        };
      }
    })

    this.toolRegister.register({
      functionName: "update_tender_record_status",
      handler: async (param: any): Promise<RequestResult> => {
        if (param.title == undefined || param.title.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_tender_record_status",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.tender.nameisrequired
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(messages.tender.nameisrequired, HttpStatus.BAD_REQUEST);
        }
        const tendername = this.toolRegister.normalizingName(param.title).trim();
        var checkTender = await this.tenderRepository.getTenderByTitle(tendername);

        if (!checkTender || checkTender.length < 1) {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_tender_record_status",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.tender.notfound
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(messages.tender.notfound, HttpStatus.NOT_FOUND);
        }
        checkTender[0].recordStatus = param.recordstatus ?? checkTender[0].recordStatus;


        var updateTender = await this.update(checkTender[0]);

        this.history.addNewHistory({
          status: "success",
          operation: "update_tender_record_status",
          parameters: this.history.getParams(param),
          result: {
            "id": updateTender.id.toString(),
            "title": updateTender.title,
          }
        }, param.req.user.username, param.sessionId)

        return {
          continuePrompt: undefined,
          toolName: "update_tender_record_status"
        }
      }
    })


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

  checkHierarchy(parent: Categories, child: Categories, param: any) {
    if (!child) {
      return true
    }

    if (child.parent.id == parent.id) {
      return true;
    }

    this.history.addNewHistory({
      status: "fault",
      operation: "update_tender",

      parameters: this.history.getParams(param),
      result: {
        "name": param.title,
        newtitle: param.newtitle
      }
    }, param.req.user.username, param.sessionId)
    throw new HttpException(`Hiyerarşiye saygı gösterilmiyor.`, HttpStatus.NOT_FOUND);

  }

  async checkRealCategory(name: string, param: any): Promise<Categories> {
    const realCategory = await this.categoryService.isCategory(name);
    if (!realCategory) {
      this.history.addNewHistory({
        status: "fault",
        operation: "update_tender",

        parameters: this.history.getParams(param),
        result: {
          "name": param.title,
          newtitle: param.newtitle
        }
      }, param.req.user.username, param.sessionId)
      throw new HttpException(`${messages.category.categorynotfound}:${name}`, HttpStatus.NOT_FOUND);
    }
    return realCategory;
  }

  async UnitIsReal(name: string, param: any) {
    const item = await this.unitService.findByName(name)

    if (!item) {
      this.history.addNewHistory({
        status: "fault",
        operation: "update_tender",

        parameters: this.history.getParams(param),
        result: {
          "name": param.title,
          "newtitle": param.newtitle
        }
      }, param.req.user.username, param.sessionId)
      throw new HttpException(`${messages.unit.itemunitfound}:${name}`, HttpStatus.NOT_FOUND);
    }
  }

  toNumber(value: string | number | null | undefined): number {
    if (value == null) return 0;
    if (typeof value === "number") return value;
    return Number(value.replaceAll(",", ".")) || 0;
  }

  calculateTotal<T>(
    categories: CategoryWithDetails<T>[],
    quantityField: keyof T,
    priceField: keyof T
  ): number {
    return categories
      .flatMap((category) => category.tenderDetails)
      .reduce((sum, detail) => {
        return sum + this.toNumber(detail[quantityField] as any) * this.toNumber(detail[priceField] as any);
      }, 0);
  }

  async importFromExcel(file: string, tenderId: number, tenderHeader: TenderHeaders, user: Users, param: any): Promise<void> {
    const actualPath = file.startsWith("/cdn")
      ? join(process.cwd(), file)
      : file;
    const workbook = XLSX.readFile(actualPath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    // چون هدر سه‌سطری و merge شده‌ست، به‌جای sheet_to_json،
    // مستقیم به‌شکل آرایه‌ی خام (بدون تفسیر هدر) می‌خونیم
    const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1, // یعنی هر ردیف یک آرایه‌ی ساده از سلول‌هاست، نه object
      defval: null,
    });

    let currentCategory = new TenderCategories();
    let categories: TenderCategories[] = [];
    const items: Items[] = await this.itemService.getAllRecords();
    let parentCategory: Categories = null;
    let childCategory: Categories = null;


    // داده‌ها از ردیف ۵ (index 4، چون صفر-پایه‌ست) شروع می‌شن
    for (let i = 4; i < rawRows.length; i++) {
      const row = rawRows[i];

      if (!row) continue;

      const firstCell = String(row[0] ?? "").trim();

      // به محض رسیدن به "ALT TOPLAM" یا "TOPLAM KEŞİF"، یعنی
      // بخش داده‌ها تموم شده -- دیگه حلقه رو متوقف کن
      if (firstCell.includes("ALT TOPLAM") || firstCell.includes("TOPLAM KEŞİF")) {
        if (currentCategory) {
          tenderHeader.tenderCategories.push(currentCategory);
        }
        break;
      }

      // اگه هم شرح کالا (ستون E) هم واحد (ستون F) خالی بودن،
      // احتمالاً این یک ردیف خالی/تزئینیه، ردش کن
      const description = row[4];
      const unit = row[5];
      if (!description && !unit) {
        if (currentCategory) {
          tenderHeader.tenderCategories.push(structuredClone(currentCategory));
          parentCategory = null;
          childCategory = null;
        }
        continue;
      }

      const isCategory = unit === null || unit === undefined || String(unit).trim() === "";

      if (isCategory) {

        const realCategory = await this.checkRealCategory(description, param);


        if (!parentCategory) {
          parentCategory = realCategory;
        }
        else if (!childCategory) {
          childCategory = realCategory;
        }
        else {
          parentCategory = childCategory;
          childCategory = realCategory
        }
        this.checkHierarchy(parentCategory, childCategory, param)

        // یک کتگوری جدید -- والدش هرچی بوده مهم نیست، فقط همینو نگه می‌داریم
        currentCategory.createAt = new Date();
        currentCategory.title = description;
        currentCategory.user = user;
        currentCategory.eskiPoz = row[0];
        currentCategory.recordStatus = recordStatus.Active;
        currentCategory.description = "";
        currentCategory.percent = row[16] != null
          ? Number(String(row[16]).replaceAll(",", "."))
          : null;
        currentCategory.tenderDetails = [];
      } else {
        // محصول -- به آخرین کتگوری دیده‌شده وصل می‌شه
        if (!currentCategory) {
          console.warn(`Ürün satırı ("${description}") herhangi bir kategoriye bağlı değil, atlanıyor.`);
          continue;
        }

        await this.UnitIsReal(unit, param);
        const currentTenderDetails = new TenderDetails();
        currentTenderDetails.alt = row[3];
        currentTenderDetails.ana = row[2];
        currentTenderDetails.createAt = new Date();

        currentTenderDetails.demontaj = row[9];

        currentTenderDetails.demontajMontaj = row[10];

        currentTenderDetails.demontajMontajPrice = row[14];

        currentTenderDetails.demontajPrice = row[13];
        currentTenderDetails.malzemeTutari = row[17];

        currentTenderDetails.demontajTutari = row[19];
        currentTenderDetails.dMMTutari = row[20];
        currentTenderDetails.eskiPoz = row[0];
        currentTenderDetails.montajPrice = row[12];
        currentTenderDetails.montajTutari = row[18];
        currentTenderDetails.tedas = row[1];
        currentTenderDetails.recordStatus = recordStatus.Active;
        currentTenderDetails.user = user;
        currentTenderDetails.tenderCategory = currentCategory;
        currentTenderDetails.firmProcuredItemPrice = row[11];
        currentTenderDetails.firmProcuredItemQuantities = row[6];
        currentTenderDetails.ourProcuredItemPrice = row[11];
        currentTenderDetails.ourProcuredItemQuantities = row[7];
        currentTenderDetails.item = items.find((itm) => itm.name.replaceAll(" ", "") == description.replaceAll(" ", ""));
        currentCategory.tenderDetails.push(currentTenderDetails);

      }

    }


  }

}