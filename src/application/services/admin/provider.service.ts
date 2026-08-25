import { forwardRef, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { SystemOperations } from 'src/domain/entities/SystemOperations';
import { SystemOperationRepository } from 'src/infrastructure/repositories/admin/system-operation.repository';
import { Workhouses } from 'src/domain/entities/Workhouses';
import { WorkhouseRepository } from 'src/infrastructure/repositories/admin/workhouse.repository';
import { Providers } from 'src/domain/entities/Providers';
import { ProviderRepository } from 'src/infrastructure/repositories/admin/provider.repository';
import { ContextManager } from '../agent/contextManager';
import { ToolRegister } from '../agent/toolRegister';
import { UserService } from '../user/user.service';
import { RequestResult } from '../agent/types';
import messages from '../agent/localFiles/messages.json'
import { UsernameSpecification } from 'src/application/specifications/user/user-specifications';
import { GenericMapper } from 'src/presentation/helpers/mapper-classes';
import { CreateProviderDto, UpdateProviderDto } from 'src/presentation/dtos/baseinfo/provider.dto';
import { RegionSpecification } from 'src/application/specifications/admin/region-specifications';
import { RegionService } from './region.service';
import { Regions } from 'src/domain/entities/Regions';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { ProviderSpecification } from 'src/application/specifications/admin/provider-specifications';


@Injectable()
export class ProviderService extends BaseService<Providers> {
    constructor(

        private readonly providerRepository: ProviderRepository,
        private readonly regionService: RegionService,
        private readonly history: ContextManager,
        private readonly toolRegister: ToolRegister,
        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,
    ) {
        super(providerRepository);
    }
    onModuleInit() {
        this.toolRegister.register({
            functionName: "create_supplier",
            handler: async (param: any): Promise<RequestResult> => {

                if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "create_supplier",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.supplier.nameisrequired
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.supplier.nameisrequired, HttpStatus.BAD_REQUEST);
                }
                if (param.regionname == undefined || param.regionname.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "create_supplier",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.supplier.regionnameisrequired
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.supplier.regionnameisrequired, HttpStatus.BAD_REQUEST);
                }

                const user = param.req.user;
                const user_specification = new UsernameSpecification(user.username);

                const [checkUser] = await this.userService.getWithSpecification(
                    user_specification,
                    null,
                    { id: true }
                );

                const suppplierDto = new CreateProviderDto();
                var regionSpecification = new RegionSpecification(this.toolRegister.normalizingName(param.regionname).trim());
                var checkRegion = await this.regionService.getWithSpecification(regionSpecification);
                if (checkRegion.length < 1) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "create_supplier",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.supplier.regionnotfound
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.supplier.regionnotfound, HttpStatus.BAD_REQUEST);
                }

                var item = GenericMapper.toEntity(Providers, suppplierDto);
                item.name=this.toolRegister.normalizingName(param.name)
                item.firm = param.selffirm,
                item.address = param.address??"",
                    item.region = { id: checkRegion[0].id } as Regions;
                item.createAt = new Date();
                item.recordStatus = recordStatus.Active;
                item.user = checkUser[0];

                var createdSupplier = await this.add(item);
                this.history.addNewHistory({
                    status: "success",
                    operation: "create_supplier",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": createdSupplier.id.toString(),
                        "name": createdSupplier.name,
                        "regionid": checkRegion[0].id.toString(),
                        "address": param.address,
                        "selffirm": param.selffirm
                    }
                }, param.req.user.username,param.sessionId)

                return {
                    continuePrompt: undefined,
                    toolName: "create_supplier"
                }



            }
        })

        this.toolRegister.register({
            functionName: "update_supplier",
            handler: async (param: any): Promise<RequestResult> => {
                if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_supplier",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.supplier.nameisrequired
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.supplier.nameisrequired, HttpStatus.BAD_REQUEST);
                }

                const supplierDto = new UpdateProviderDto();
                supplierDto.address = param.address;
                supplierDto.firm = param.selffirm;
                supplierDto.name = param.newname;
                supplierDto.phone = param.phone;


                var updateProvider = await this.providerRepository.findByName(this.toolRegister.normalizingName(param.name).trim());
                if (updateProvider == null) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_supplier",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.supplier.notfound
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.supplier.notfound, HttpStatus.BAD_REQUEST);
                }

                if (param.regionname != "" && param.regionname != undefined) {
                    var regionSpecification = new RegionSpecification(this.toolRegister.normalizingName(param.regionname).trim());
                    var checkRegion = await this.regionService.getWithSpecification(regionSpecification);
                    if (checkRegion.length < 1) {
                        this.history.addNewHistory({
                            status: "fault",
                            operation: "update_supplier",
                            parameters: this.history.getParams(param),
                            result: {
                                errorMessage: messages.supplier.regionnotfound
                            }
                        }, param.req.user.username,param.sessionId)
                        throw new HttpException(messages.supplier.regionnotfound, HttpStatus.BAD_REQUEST);
                    }
                    else{
                        updateProvider.region = { id:  checkRegion[0].id } as Regions;
                    }
                }


                updateProvider.name = supplierDto.name ?? updateProvider.name;
                updateProvider.address = supplierDto.address ?? updateProvider.address;
                updateProvider.phone = supplierDto.phone ?? updateProvider.phone;
                updateProvider.firm = supplierDto.firm ?? updateProvider.firm;
                
                var updateProvider = await this.update(updateProvider);
                 this.history.addNewHistory({
                    status: "success",
                    operation: "update_supplier",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": updateProvider.id.toString(),
                        "name": updateProvider.name,
                        "address": updateProvider.address,
                        "phone":updateProvider.phone,
                        "firm":updateProvider.firm?"1":"0"
                    }
                }, param.req.user.username,param.sessionId)

                return {
                    continuePrompt: undefined,
                    toolName: "update_supplier"
                }

            }
        })

        this.toolRegister.register({
            functionName: "delete_supplier",
            handler: async (param: any): Promise<RequestResult> => {

                if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "delete_region",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.supplier.nameisrequired
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.supplier.nameisrequired, HttpStatus.BAD_REQUEST);
                }

                const deleteSupplierName = this.toolRegister.normalizingName(param.name);

                var deleteSupplier = await this.providerRepository.findByName(deleteSupplierName.trim());
                if (deleteSupplier==null) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_region",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.supplier.notfound
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.supplier.notfound, HttpStatus.BAD_REQUEST);
                }

                var deleteProduct = await this.delete(deleteSupplier.id);
                this.history.addNewHistory({
                    status: "success",
                    operation: "delete_region",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": deleteSupplier.id.toString(),
                        "name": deleteSupplierName,
                    }
                }, param.req.user.username,param.sessionId)


                return {
                    continuePrompt: undefined,
                    toolName: "delete_supplier"
                };
            }
        })

        this.toolRegister.register({
            functionName: "update_supplier_record_status",
            handler: async (param: any): Promise<RequestResult> => {
              if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_supplier_record_status",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.supplier.nameisrequired
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.supplier.nameisrequired, HttpStatus.BAD_REQUEST);
                }

                const supplierDto = new UpdateProviderDto();
                supplierDto.recordStatus = param.recordstatus;


                var updateProvider = await this.providerRepository.findByName(this.toolRegister.normalizingName(param.name).trim());
                if (updateProvider == null) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_supplier_record_status",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.supplier.notfound
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.supplier.notfound, HttpStatus.BAD_REQUEST);
                }

              


                updateProvider.recordStatus = supplierDto.recordStatus ?? updateProvider.recordStatus;
                var updateProvider = await this.update(updateProvider);
                 this.history.addNewHistory({
                    status: "success",
                    operation: "update_supplier_record_status",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": updateProvider.id.toString(),
                        "name": updateProvider.name,
                        "recordstatus":updateProvider.recordStatus.toString()
                    }
                }, param.req.user.username,param.sessionId)

                return {
                    continuePrompt: undefined,
                    toolName: "update_supplier_record_status"
                }
            }
        })


    }
}