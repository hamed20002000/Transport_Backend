import { forwardRef, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { SystemOperations } from 'src/domain/entities/SystemOperations';
import { SystemOperationRepository } from 'src/infrastructure/repositories/admin/system-operation.repository';
import { ItemUnits } from 'src/domain/entities/ItemUnits';
import { ItemUnitRepository } from 'src/infrastructure/repositories/admin/item-unit.repository';
import { TenderHeaders } from 'src/domain/entities/TenderHeaders';
import { TenderRepository } from 'src/infrastructure/repositories/admin/tender.repository';
import { TenderListDto, UpdateTenderDto, UpdateTenderHeaderDto } from 'src/presentation/dtos/initial-operations/tender-dto';
import { ToolRegister } from '../agent/toolRegister';
import { UserService } from '../user/user.service';
import { ContextManager } from '../agent/contextManager';
import { RequestResult } from '../agent/types';
import messages from '../agent/localFiles/messages.json';
import { UsernameSpecification } from 'src/application/specifications/user/user-specifications';
import { tenderStatus } from 'src/domain/enums/tenderstatus.enum';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { TenderCategories } from 'src/domain/entities/TenderCategories';


@Injectable()
export class TenderService extends BaseService<TenderHeaders> {
  constructor(

    private readonly tenderRepository: TenderRepository,
      private readonly toolRegister: ToolRegister,
        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,
        private readonly history: ContextManager,
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
          }, param.req.user.username)
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
                tender.title = this.toolRegister.normalizingName(param.title).trim();
                tender.status = tenderStatus.Pending;
                tender.attachments = null;
                tender.createAt = new Date();
        
                tender.recordStatus = recordStatus.Active;
                tender.user = checkUser;
                  
                if(param.file.length>0){

                }
                // ✅ اضافه کردن دسته‌بندی‌ها و جزئیات
                if (tenderDto.tenderCategories && tenderDto.tenderCategories.length > 0) {
                    tender.tenderCategories = tenderDto.tenderCategories.map((catDto) => {
                        const cat = new TenderCategories();
                        cat.title = catDto.title;
                        cat.eskiPoz = catDto.eskiPoz;
                        cat.percent = catDto.percent;
                        cat.description = catDto.description;
                        cat.createAt = new Date();
                        cat.recordStatus = recordStatus.Active;
                        cat.user = checkUser;
        
                        // جزئیات این دسته
                        if (catDto.details && catDto.details.length > 0) {
                            cat.tenderDetails = catDto.details.map((detailDto) => {
                                const detail = new TenderDetails();
                                detail.eskiPoz = detailDto.eskiPoz;
                                detail.tedas = detailDto.tedas;
                                detail.ana = detailDto.ana;
                                detail.alt = detailDto.alt;
        
                                detail.firmProcuredItemQuantities = detailDto.firmProcuredItemQuantities;
                                detail.ourProcuredItemQuantities = detailDto.ourProcuredItemQuantities;
                                detail.demontaj = detailDto.demontaj;
                                detail.demontajMontaj = detailDto.demontajMontaj;
                                detail.firmProcuredItemPrice = detailDto.firmProcuredItemPrice;
                                detail.ourProcuredItemPrice = detailDto.ourProcuredItemPrice;
                                detail.montajPrice = detailDto.montajPrice;
                                detail.demontajPrice = detailDto.demontajPrice;
                                detail.demontajMontajPrice = detailDto.demontajMontajPrice;
                                detail.malzemeTutari = detailDto.malzemeTutari;
                                detail.montajTutari = detailDto.montajTutari;
                                detail.demontajTutari = detailDto.demontajTutari;
                                detail.dMMTutari = detailDto.dMMTutari;
        
                                detail.item = new Items();
                                detail.item.id = detailDto.itemId;
        
                                detail.createAt = new Date();
                                detail.recordStatus = recordStatus.Active;
                                detail.user = checkUser;
        
                                return detail;
                            });
                        }
        
                        return cat;
                    });
                }
        
                // ✅ ذخیره با cascade کامل
                const createdTender = await this.tenderService.add(tender);
                this.gateway.notifyRole(['admin'], 'new-notify', {
                    id: createdTender.id,
                    createdAt: createdTender.createAt,
                    type: 'tender',
                });




        const forceMajorDto = new CreateForceMajorDto();
        forceMajorDto.title = param.title;

        var forceMajor = GenericMapper.toEntity(ForceMajors, forceMajorDto);
        forceMajor.createAt = new Date();
        forceMajor.recordStatus = recordStatus.Active;
        forceMajor.user = checkUser[0];

        var createForceMajor = await this.add(forceMajor);

        this.history.addNewHistory({
          status: "success",
          operation: "create_force_major",
          parameters: this.history.getParams(param),
          result: {
            "id": forceMajor.id.toString(),
            "title": forceMajor.title,
            "recordstatus": forceMajor.recordStatus.toString(),
          }
        }, param.req.user.username)

        return {
          continuePrompt: undefined,
          toolName: "create_force_major"
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

  // extractXlsxFile(file:File):TenderCategories{

  // }

}