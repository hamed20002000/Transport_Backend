import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { SystemOperations } from 'src/domain/entities/SystemOperations';
import { SystemOperationRepository } from 'src/infrastructure/repositories/admin/system-operation.repository';
import { ItemUnits } from 'src/domain/entities/ItemUnits';
import { ItemUnitRepository } from 'src/infrastructure/repositories/admin/item-unit.repository';
import { TenderHeaders } from 'src/domain/entities/TenderHeaders';
import { TenderRepository } from 'src/infrastructure/repositories/admin/tender.repository';
import { TenderListDto, UpdateTenderDto } from 'src/presentation/dtos/initial-operations/tender-dto';
import { Networks } from 'src/domain/entities/Networks';
import { NetworkRepository } from 'src/infrastructure/repositories/admin/network.repository';
import { UpdateNetworkDto } from 'src/presentation/dtos/initial-operations/network-dto';
import { ContextManager } from '../agent/contextManager';
import { ToolRegister } from '../agent/toolRegister';
import { UserService } from '../user/user.service';
import { RequestResult } from '../agent/types';
import { UsernameSpecification } from 'src/application/specifications/user/user-specifications';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { Works } from 'src/domain/entities/Works';
import message from '../agent/localFiles/messages.json'
import { HttpService } from '@nestjs/axios';
import { WorkService } from './work.service';
import * as XLSX from 'xlsx';
import { ItemDefinition, ParsedExcelResult, WorkDetailRow, WorkDetailSubEntry, WorkItemDetail } from '../agent/interfaces/IExcel';
import { UserUpdateDto } from 'src/presentation/dtos/user/user.dto';
import { join } from 'path';
import { ProductTypeService } from './product-type.service';
import { ItemService } from './item.service';
import { ILike } from 'typeorm';


@Injectable()
export class NetworkService extends BaseService<Networks> {
  constructor(

    private readonly networkRepository: NetworkRepository,
    private readonly toolRtegister: ToolRegister,
    private readonly userService: UserService,
    private readonly history: ContextManager,
    private readonly workService: WorkService,
    private readonly itemTypeService: ProductTypeService,
    private readonly productService: ItemService
  ) {
    super(networkRepository);
  }


  onModuleInit() {
    const self = this;

    this.toolRtegister.register({
      functionName: "create_network",
      handler: async function* (param: any): AsyncGenerator<any, RequestResult, any> {

        if (param.title == "" || param.title == null) {
          self.history.addNewHistory({
            status: "fault",
            operation: "create_network",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.network.nameisrequired
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.network.nameisrequired, HttpStatus.BAD_REQUEST);
        }



        const user = param.req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await self.userService.getWithSpecification(
          user_specification,
          null,
          { id: true }
        );

        const title = self.toolRtegister.normalizingName(param.title).trim();
        const workname = param.workname.trim();
        const description = param.description?.trim() ?? "";

        const network = new Networks();
        network.title = title;
        network.description = description;
        var works = (await self.workService.getWorkByTitle(workname));
        if (works.length > 1) {
          const workId = yield { type: "selection", label: "İşlerden birini seçin.", data: works.map((item) => ({ title: item.title, id: item.id })) }
          network.work = await self.workService.getById(workId)
        }
        else if(works.length === 1) {
          network.work = works[0]
        }
        else{
          self.history.addNewHistory({
            status: "fault",
            operation: "create_network",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.work.notfound
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.work.notfound, HttpStatus.BAD_REQUEST);
        }
        network.createAt = new Date();
        network.recordStatus = recordStatus.Active;
        network.user = checkUser;



        const createdNetwork = await self.add(network);


        self.history.addNewHistory({
          status: "success",
          operation: "create_network",
          parameters: self.history.getParams(param),
          result: {
            "id": createdNetwork.id.toString(),
            "title": createdNetwork.title,
            "workid": createdNetwork.work.id.toString(),
            "createAt": createdNetwork.createAt.toString(),
            "recordStatus": createdNetwork.recordStatus.toString(),
          }
        }, param.req.user.username, param.sessionId)


        return {
          continuePrompt: "Ayrıntı eklemek için yöntemlerden birini seçin.",
          toolName: "create_network"
        };
      }
    })


    this.toolRtegister.register({
      functionName: "update_network",
      handler: async function* (param: any): AsyncGenerator<any, RequestResult, any> {

        const title = self.toolRtegister.normalizingName(param.title.trim());
        const newtitle = param.newtitle!=null&&param.newtitle!=""?self.toolRtegister.normalizingName(param.newtitle).trim():null;
        const description =param.description!=null&&param.description!=""?self.toolRtegister.normalizingName(param.description).trim():null;
        const workname = param.newworkname!=null&&param.newworkname!=""?self.toolRtegister.normalizingName(param.newworkname).trim():null;
        var updateDto = new Networks();
      

          if (param.title == "" || param.title == null) {
          self.history.addNewHistory({
            status: "fault",
            operation: "update_network",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.network.nameisrequired
            }
          }, param.req.user.username, param.sessionId)
          throw new HttpException(message.network.nameisrequired, HttpStatus.BAD_REQUEST);
        }

         var networks = (await self.getWorkNetworkWithTitle(title));
        if (networks.length > 1) {
          const networkId = yield { type: "selection", label: "Şebekelerden birini seçin.", data: networks.map((item) => ({ title: item.title, id: item.id })) }
          updateDto= await self.getNetworkById(networkId)
        }
        else if(networks.length === 1) {
          updateDto = networks[0]
        }
        else{
          self.history.addNewHistory({
            status: "fault",
            operation: "create_network",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.work.notfound
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.work.notfound, HttpStatus.BAD_REQUEST);
        }
        
            if (newtitle!= "" && newtitle != null) {
                 updateDto.title=newtitle
         }
            if (description!= "" && description != null) {
                 updateDto.description=description
         }


        if (workname != "" && workname != null) {
          var works = (await self.workService.getWorkByTitle(workname));
          if (works.length > 1) {
           const workId = yield { type: "selection", label: "İşlerden birini seçin.", data: works.map((item) => ({ title: item.title, id: item.id })) }
           updateDto.work=await self.workService.getById(workId);
          }
          else if (works.length == 0) {
            updateDto.work = works[0]
          }
          else {
            self.history.addNewHistory({
              status: "fault",
              operation: "update_network",
              parameters: self.history.getParams(param),
              result: {
                errorMessage: message.work.notfound
              }
            }, param.req.user.username, param.sessionId)
            throw new HttpException(message.work.notfound, HttpStatus.BAD_REQUEST);
          }
        }

      



        if (param.files && param.files.length > 0) {
          const user = param.req.user;
          const user_specification = new UsernameSpecification(user.username);
          const productTypes = new Set((await self.itemTypeService.getAllRecords()).map((item) => item.name));
          const products = new Set((await self.productService.getAllRecords()).map((item) => item.name));
          const excelResult = self.parseWorkExcelFile(param.files[0], productTypes, products)
          
        }




             await self.update(updateDto)

        // self.history.addNewHistory({
        //   status: "success",
        //   operation: "update_network",
        //   parameters: self.history.getParams(param),
        //   result: {
        //     "id": updatedUser.id.toString(),
        //     "username": updatedUser.username,
        //     "password": updatedUser.password,
        //     "createAt": updatedUser.createAt.toString(),
        //     "recordStatus": updatedUser.recordStatus.toString(),
        //     "roles": updatedUser.roles.join(",")
        //   }
        // }, param.req.user.username, param.sessionId)

        return {
          continuePrompt: undefined,
          toolName: "update_network"
        };
      }
    })


    this.toolRtegister.register({
      functionName: "update_network_record_status",
      handler: async function* (param: any): AsyncGenerator<any, RequestResult, any> {
        if (param.title == "" || param.title == null) {
          self.history.addNewHistory({
            status: "fault",
            operation: "update_network_record_status",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.user.usernamerequired
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.user.usernamerequired, HttpStatus.BAD_REQUEST);
        }

        const title = self.toolRtegister.normalizingName(param.title).trim();
        let network = new Networks();
        var networks = (await self.networkRepository.getWorkNetworkWithTitle(title));

        if (networks.length > 1) {
          const networkId = yield { type: "selection", label: "Şebekelerden birini seçin.", data: networks.map((item) => ({ title: item.title, id: item.id })) }
          network = await self.networkRepository.getNetworkById(networkId)
        }
        else if (networks.length == 1) {
          network = networks[0]
        }
        else {
          self.history.addNewHistory({
            status: "fault",
            operation: "update_network_record_status",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.network.notfound
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.network.notfound, HttpStatus.BAD_REQUEST);
        }
        network.recordStatus = param.recordStatus;
        await self.update(network);

        self.history.addNewHistory({
          status: "success",
          operation: "update_network_record_status",
          parameters: self.history.getParams(param),
          result: {
            "id": network.id.toString(),
            "title": network.title,
            "recordStatus": network.recordStatus.toString(),
          }
        }, param.req.user.username, param.sessionId)
        return {
          continuePrompt: undefined,
          toolName: "update_network_record_status"
        };
      }
    })

    this.toolRtegister.register({
      functionName: "delete_network",
      handler: async function* (param: any): AsyncGenerator<any, RequestResult, any> {
        if (param.title == "" || param.title == null) {
          self.history.addNewHistory({
            status: "fault",
            operation: "delete_network",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.user.usernamerequired
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.user.usernamerequired, HttpStatus.BAD_REQUEST);
        }

        const title = self.toolRtegister.normalizingName(param.title).trim();
        let networkId = null
        var networks = (await self.networkRepository.getWorkNetworkWithTitle(title));

        if (networks.length > 1) {
          networkId = yield { type: "selection", label: "Şebekelerden birini seçin.", data: networks.map((item) => ({ title: item.title, id: item.id })) }
        }
        else if (networks.length == 1) {
          networkId = networks[0].id
        }
        else {
          self.history.addNewHistory({
            status: "fault",
            operation: "update_network_record_status",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.network.notfound
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.network.notfound, HttpStatus.BAD_REQUEST);
        }
        await self.delete(networkId);

        self.history.addNewHistory({
          status: "success",
          operation: "delete_network",
          parameters: self.history.getParams(param),
          result: {
            "id": networkId.toString(),
            "title": title,
          }
        }, param.req.user.username, param.sessionId)
        return {
          continuePrompt: undefined,
          toolName: "delete_network"
        };
      }
    })








  }

  async getAllNetworks(): Promise<Networks[]> {
    return this.networkRepository.getAllNetworks();
  }

  async getNetworkById(id: number): Promise<Networks> {
    return this.networkRepository.getNetworkById(id);
  }
  async getNetworkByWorkId(workId: number): Promise<Networks> {
    return this.networkRepository.getNetworkByWorkId(workId);
  }
  async getTransmissionRowByNetworkId(id: number): Promise<Networks> {
    return this.networkRepository.getTransmissionRowByNetworkId(id);
  }
  async updateNetwork(networkDto: UpdateNetworkDto): Promise<void> {
    return this.networkRepository.updateNetwork(networkDto);
  }

  async deleteNetwork(id: number): Promise<void> {
    return this.networkRepository.deleteNetwork(id);
  }

  async getWorkWithTitle(title: string): Promise<Works[]> {
    return await this.workService.getWorkByTitle(title);
  }
    async getWorkNetworkWithTitle(title: string): Promise<Networks[]> { 
      return await this.networkRepository.getWorkNetworkWithTitle(title);
    }

  getCellValueIntelligently(
    worksheet: XLSX.WorkSheet,
    row: number,
    col: number,
  ): string {
    const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
    const cell = worksheet[cellRef];
    if (!cell) return '';
    if (cell.w !== undefined && cell.w !== null && cell.w !== '') {
      return String(cell.w).trim();
    }
    if (cell.v === undefined || cell.v === null) return '';
    return String(cell.v).trim();
  }

  extractItemDefinitions(
    worksheet: XLSX.WorkSheet,
    range: XLSX.Range,
  ): ItemDefinition[] {
    const itemDefinitions: ItemDefinition[] = [];
    let lastHeaderName = '';
    let lastHeaderStartCol = -1;

    for (let C = 5; C <= range.e.c; C++) {
      const currentHeaderCellContent = this.getCellValueIntelligently(worksheet, 2, C);

      if (currentHeaderCellContent !== '') {
        if (lastHeaderName !== '' && lastHeaderStartCol !== -1) {
          itemDefinitions.push({
            name: lastHeaderName,
            nameColIdx: lastHeaderStartCol,
            valueColIdx: lastHeaderStartCol,
          });
        }
        lastHeaderName = currentHeaderCellContent;
        lastHeaderStartCol = C;
      } else if (lastHeaderName === '' && lastHeaderStartCol === -1) {
        let allRemainingEmpty = true;
        for (let nextC = C + 1; nextC <= range.e.c; nextC++) {
          if (this.getCellValueIntelligently(worksheet, 2, nextC) !== '') {
            allRemainingEmpty = false;
            break;
          }
        }
        if (allRemainingEmpty) break;
      }
    }

    if (lastHeaderName !== '' && lastHeaderStartCol !== -1) {
      itemDefinitions.push({
        name: lastHeaderName,
        nameColIdx: lastHeaderStartCol,
        valueColIdx: lastHeaderStartCol,
      });
    }

    return itemDefinitions;
  }

  generateId(prefix: string, index: number): string {
    return `${prefix}-${Date.now()}-${index}-${Math.random().toString(36).substring(7)}`;
  }

  generateTempId(index: number): string {
    return String(Date.now() + index + Math.random());
  }

  /**
 * Excel buffer'ını (Multer'dan gelen file.buffer) parse eder ve
 * TR ADI'ya göre gruplanmış iş kayıtlarını, her grup için TOPLAM satırını,
 * ve sistemde kayıtlı olmayan ürün tipi / öğe isimlerini döner.
 *
 * @param buffer Yüklenen dosyanın ham buffer'ı
 * @param existingProductTypeNames DB'deki mevcut ürün tipi isimleri (lowercase)
 * @param existingItemNames DB'deki mevcut öğe isimleri (lowercase)
 * @throws Error Excel formatı geçersizse (BadRequestException'a çevirmek çağıran tarafın işi)
 */
  parseWorkExcelFile(
    file: string,
    existingProductTypeNames: Set<string>,
    existingItemNames: Set<string>,
  ): ParsedExcelResult {
    const actualPath = file.startsWith('/cdn') ? join(process.cwd(), file) : file;

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.readFile(actualPath);
    } catch {
      throw new Error(
        'Excel dosyası işlenirken bir hata oluştu. Lütfen dosyanın formatını kontrol edin.',
      );
    }

    if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error('Excel dosyası geçersiz veya içinde hiçbir sayfa bulunamadı.');
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    if (!worksheet) {
      throw new Error('Belirtilen sayfaya sahip çalışma sayfası bulunamadı.');
    }
    if (!worksheet['!ref']) {
      throw new Error('Excel dosyası formatı geçersiz: Sayfa aralığı bilgisi bulunamadı.');
    }

    const range = XLSX.utils.decode_range(worksheet['!ref']);

    if (range.e.r < 3 || range.e.c < 6) {
      return {
        registeredWorkEntries: [],
        unregisteredProductTypes: [],
        unregisteredItems: [],
      };
    }

    const itemDefinitions = this.extractItemDefinitions(worksheet, range);

    const newUnregisteredProductTypes = new Set<string>();
    const newUnregisteredItems = new Set<string>();
    const newRegisteredWorkEntries: WorkDetailRow[] = [];
    const tempTrAdiSubEntries: { [trAdiId: string]: WorkDetailSubEntry[] } = {};

    let currentTrAdiRow: WorkDetailRow | null = null;
    let currentSubEntryIdCounter = 1;

    for (let R = 3; R <= range.e.r; R++) {
      const trAdiFromExcel = this.getCellValueIntelligently(worksheet, R, 0);
      const dnFromExcel = this.getCellValueIntelligently(worksheet, R, 1);
      const yeniFromExcel = this.getCellValueIntelligently(worksheet, R, 2);
      const dmmFromExcel = this.getCellValueIntelligently(worksheet, R, 3);
      const mevcutFromExcel = this.getCellValueIntelligently(worksheet, R, 4);

      if (trAdiFromExcel !== '') {
        if (trAdiFromExcel.toUpperCase() === 'TOPLAM') {
          continue;
        }
        const existingRow = newRegisteredWorkEntries.find((row) => row.trAdi === trAdiFromExcel);
        if (existingRow) {
          currentTrAdiRow = existingRow;
        } else {
          currentTrAdiRow = {
            id: this.generateId('tradi', newRegisteredWorkEntries.length + 1),
            trAdi: trAdiFromExcel,
            subEntries: [],
          };
          newRegisteredWorkEntries.push(currentTrAdiRow);
          tempTrAdiSubEntries[currentTrAdiRow.id] = [];
        }
      }

      if (!currentTrAdiRow) {
        throw new Error('Excel dosyasının formatı geçersiz: İlk veri satırında TR ADI bulunamadı.');
      }

      const hasSubEntryData =
        dnFromExcel !== '' ||
        yeniFromExcel !== '' ||
        dmmFromExcel !== '' ||
        mevcutFromExcel !== '' ||
        itemDefinitions.some(
          (itemDef) => this.getCellValueIntelligently(worksheet, R, itemDef.valueColIdx) !== '',
        );

      if (!hasSubEntryData) continue;

      const newItemDetails: WorkItemDetail[] = [];
      itemDefinitions.forEach((itemDef) => {
        const itemValue = this.getCellValueIntelligently(worksheet, R, itemDef.valueColIdx);
        if (itemValue !== '' && itemDef.name !== '') {
          newItemDetails.push({
            id: this.generateId('item', newItemDetails.length),
            tempId: this.generateTempId(newItemDetails.length),
            name: itemDef.name,
            value: itemValue,
          });
          if (!existingItemNames.has(itemDef.name.toLowerCase())) {
            newUnregisteredItems.add(itemDef.name);
          }
        }
      });

      if (
        dnFromExcel !== '' &&
        dnFromExcel.toUpperCase() !== 'TOPLAM' &&
        !existingProductTypeNames.has(dnFromExcel.toLowerCase())
      ) {
        newUnregisteredProductTypes.add(dnFromExcel);
      }

      const newSubEntry: WorkDetailSubEntry = {
        id: `${currentTrAdiRow.id}-sub-${currentSubEntryIdCounter++}`,
        trAdiParentId: currentTrAdiRow.id,
        dn: dnFromExcel,
        yeni: yeniFromExcel,
        dmm: dmmFromExcel,
        mevcut: mevcutFromExcel,
        itemDetails: newItemDetails,
        isToplamRow: false,
      };
      tempTrAdiSubEntries[currentTrAdiRow.id].push(newSubEntry);
    }

    // Her TR ADI grubu için TOPLAM satırını hesapla
    newRegisteredWorkEntries.forEach((trAdiRow) => {
      const subEntriesForThisTrAdi = tempTrAdiSubEntries[trAdiRow.id];
      const itemTotals: { [itemName: string]: number } = {};

      subEntriesForThisTrAdi.forEach((sub) => {
        sub.itemDetails.forEach((item) => {
          itemTotals[item.name] = (itemTotals[item.name] || 0) + parseFloat(item.value || '0');
        });
      });

      const totalItemDetails: WorkItemDetail[] = Object.keys(itemTotals).map((name) => ({
        id: `total-item-${trAdiRow.id}-${name}`,
        tempId: `total-item-temp-${trAdiRow.id}-${name}-${Date.now()}`,
        name,
        value: itemTotals[name].toString(),
      }));

      const totalSubEntry: WorkDetailSubEntry = {
        id: `${trAdiRow.id}-sub-TOTAL`,
        trAdiParentId: trAdiRow.id,
        dn: 'TOPLAM',
        yeni: '',
        dmm: '',
        mevcut: '',
        itemDetails: totalItemDetails,
        isToplamRow: true,
      };

      trAdiRow.subEntries = [...subEntriesForThisTrAdi, totalSubEntry];
    });

    return {
      registeredWorkEntries: newRegisteredWorkEntries,
      unregisteredProductTypes: Array.from(newUnregisteredProductTypes),
      unregisteredItems: Array.from(newUnregisteredItems),
    };
  }







}