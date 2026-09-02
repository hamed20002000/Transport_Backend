import { forwardRef, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { SystemOperations } from 'src/domain/entities/SystemOperations';
import { SystemOperationRepository } from 'src/infrastructure/repositories/admin/system-operation.repository';
import { Categories } from 'src/domain/entities/Categories';
import { CategoryRepository } from 'src/infrastructure/repositories/admin/category.repository';
import { CategoryListDto } from 'src/presentation/dtos/baseinfo/category-dto';
import { plainToInstance } from 'class-transformer';
import { Regions } from 'src/domain/entities/Regions';
import { RegionRepository } from 'src/infrastructure/repositories/admin/region.repository';
import { CreateRegionDto, RegionListDto, UpdateRegionDto } from 'src/presentation/dtos/baseinfo/region-dto';
import { ContextManager } from '../agent/contextManager';
import { ToolRegister } from '../agent/toolRegister';
import { UserService } from '../user/user.service';
import { RequestResult } from '../agent/types';
import messages from '../agent/localFiles/messages.json'
import { UsernameSpecification } from 'src/application/specifications/user/user-specifications';
import { RegionSpecification, RegionUpdateSpecification } from 'src/application/specifications/admin/region-specifications';
import { GenericMapper } from 'src/presentation/helpers/mapper-classes';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';


@Injectable()
export class RegionService extends BaseService<Regions> {
    constructor(

        private readonly regionRepository: RegionRepository,
        private readonly history: ContextManager,
        private readonly toolRegister: ToolRegister,
        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,
    ) {
        super(regionRepository);
    }


    onModuleInit() {
        this.toolRegister.register({
            functionName: "create_region",
            handler: async (param: any): Promise<RequestResult> => {

                if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "create_region",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.region.nameisrequired
                        }
                    }, param.req.user.username, param.sessionId)
                    throw new HttpException(messages.region.nameisrequired, HttpStatus.BAD_REQUEST);
                }



                const user = param.req.user;
                const user_specification = new UsernameSpecification(user.username);

                const [checkUser] = await this.userService.getWithSpecification(
                    user_specification,
                    null,
                    { id: true }
                );

                const regionDto = new CreateRegionDto();
                var specification = new RegionSpecification(regionDto.name.trim());
                var checkRegion = await this.getWithSpecification(specification);
                if (checkRegion.length > 0) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "create_region",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.region.regionalreadyexists
                        }
                    }, param.req.user.username, param.sessionId)
                    throw new HttpException(messages.region.regionalreadyexists, HttpStatus.BAD_REQUEST);
                }

                if (param.parentname != "" && param.parentname != undefined) {
                    var parentSpecification = new RegionSpecification(this.toolRegister.normalizingName(param.parentname).trim());
                    var parentCheckRegion = await this.getWithSpecification(parentSpecification);

                    if (parentCheckRegion.length < 1) {
                        this.history.addNewHistory({
                            status: "fault",
                            operation: "create_region",
                            parameters: this.history.getParams(param),
                            result: {
                                errorMessage: messages.region.parentnamenotfound
                            }
                        }, param.req.user.username, param.sessionId)
                        throw new HttpException(messages.region.parentnamenotfound, HttpStatus.BAD_REQUEST);
                    }

                    regionDto.parentId = parentCheckRegion[0].id;
                }


                regionDto.name = this.toolRegister.normalizingName(param.name)



                var region = GenericMapper.toEntity(Regions, regionDto);
                region.name = regionDto.name.trim();
                region.depth = 0;
                region.createAt = new Date();
                region.recordStatus = recordStatus.Active;
                region.user = checkUser[0];
                if (regionDto.parentId) {

                    region.depth = parentCheckRegion[0].depth + 1;
                    region.parent = parentCheckRegion[0]
                } else {
                    region.parent = null;
                    region.depth = 0;
                }

                var createRegion = await this.add(region);
                this.history.addNewHistory({
                    status: "success",
                    operation: "create_region",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": createRegion.id.toString(),
                        "name": param.name,
                        "parentid": region.parent.id.toString()
                    }
                }, param.req.user.username, param.sessionId)

                return {
                    continuePrompt: undefined,
                    toolName: "create_region"
                }



            }
        })

        this.toolRegister.register({
            functionName: "update_region",
            handler: async (param: any): Promise<RequestResult> => {


                //#region ----------------- check param.name sended or not ---
                if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_region",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.region.nameisrequired
                        }
                    }, param.req.user.username, param.sessionId)
                    throw new HttpException(messages.region.nameisrequired, HttpStatus.BAD_REQUEST);
                }
                //#endregion ----------------- check param.name sended or not ---


                const regionName = this.toolRegister.normalizingName(param.name).trim();
                const newparentname=param.newparentname;

                //#region ----------------- check param.name is valid ---
                var specification = new RegionSpecification(regionName);
                var checkRegion = await this.getWithSpecification(specification);
                if (checkRegion.length > 0) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_region",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.region.notfound
                        }
                    }, param.req.user.username, param.sessionId)
                    throw new HttpException(messages.region.notfound, HttpStatus.BAD_REQUEST);
                }
                //#endregion --------------------------------------------------


                //#region ------------------ check newname dont exist ----
                const regionDto = new UpdateRegionDto();
                regionDto.newname = this.toolRegister.normalizingName(param.newname)?.trim() ?? checkRegion[0].name;
                regionDto.parentId = checkRegion[0].parent.id;
                if (param.newname != null && param.newname != undefined) {
                    var updatespecification = new RegionSpecification(regionDto.newname);
                    var checkRegionForUpdate = await this.getWithSpecification(updatespecification);
                    if (checkRegionForUpdate.length > 0) {

                        this.history.addNewHistory({
                            status: "fault",
                            operation: "update_region",
                            parameters: this.history.getParams(param),
                            result: {
                                errorMessage: messages.region.regionalreadyexists
                            }
                        }, param.req.user.username, param.sessionId)


                        throw new HttpException(messages.region.regionalreadyexists, HttpStatus.BAD_REQUEST);
                    }
                }
                //#endregion ---------------------------------------------------
                
                let oldDepth = checkRegion[0].depth;

                //#region ------------------- check  newparent exist? ----------
                  if(newparentname != undefined && newparentname != null && newparentname != ""){

                      var parentSpecification = new RegionSpecification(this.toolRegister.normalizingName(newparentname).trim());
                    var parentCheckRegion = await this.getWithSpecification(parentSpecification);

                    if (parentCheckRegion.length < 1) {
                        this.history.addNewHistory({
                            status: "fault",
                            operation: "update_region",
                            parameters: this.history.getParams(param),
                            result: {
                                errorMessage: messages.region.parentnamenotfound
                            }
                        }, param.req.user.username, param.sessionId)
                        throw new HttpException(messages.region.parentnamenotfound, HttpStatus.BAD_REQUEST);
                    }
                    checkRegion[0].depth = parentCheckRegion[0].depth + 1;
                    regionDto.parentId = parentCheckRegion[0].id;
                      
                  }
                  //#endregion ---------------------------------------------------------

               

           

                var updateRegion = await this.update(checkRegion[0]);

                if (checkRegion[0].depth !== oldDepth) {
                
                    this.updateChildrenDepth(checkRegion[0].id);

                }


                this.history.addNewHistory({
                    status: "success",
                    operation: "update_region",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": updateRegion.id.toString(),
                        "name": param.newName,
                        "parentid": updateRegion.parent.id.toString(),
                    }
                }, param.req.user.username, param.sessionId)

                return {
                    continuePrompt: undefined,
                    toolName: "update_region"
                }

            }
        })

        this.toolRegister.register({
            functionName: "delete_region",
            handler: async (param: any): Promise<RequestResult> => {

                if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "delete_region",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.region.nameisrequired
                        }
                    }, param.req.user.username, param.sessionId)
                    throw new HttpException(messages.region.nameisrequired, HttpStatus.BAD_REQUEST);
                }

                const deleteProductname = this.toolRegister.normalizingName(param.name);

                var specification = new RegionSpecification(this.toolRegister.normalizingName(param.name).trim());
                var checkRegion = await this.getWithSpecification(specification);
                if (checkRegion.length < 1) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_region",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.region.notfound
                        }
                    }, param.req.user.username, param.sessionId)
                    throw new HttpException(messages.region.notfound, HttpStatus.BAD_REQUEST);
                }

                var deleteProduct = await this.delete(checkRegion[0].id);
                this.history.addNewHistory({
                    status: "success",
                    operation: "delete_region",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": checkRegion[0].id.toString(),
                        "name": deleteProductname,
                    }
                }, param.req.user.username, param.sessionId)


                return {
                    continuePrompt: undefined,
                    toolName: "delete_region"
                };
            }
        })



        this.toolRegister.register({
            functionName: "update_region_record_status",
            handler: async (param: any): Promise<RequestResult> => {
                if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_region_record_status",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.region.nameisrequired
                        }
                    }, param.req.user.username, param.sessionId)
                    throw new HttpException(messages.region.nameisrequired, HttpStatus.BAD_REQUEST);
                }

                var specification = new RegionSpecification(this.toolRegister.normalizingName(param.name).trim());
                var checkRegion = await this.getWithSpecification(specification);
                if (checkRegion.length < 1) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_region_record_status",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.region.notfound
                        }
                    }, param.req.user.username, param.sessionId)
                    throw new HttpException(messages.region.notfound, HttpStatus.BAD_REQUEST);
                }

                checkRegion[0].recordStatus = param.recordstatus ?? checkRegion[0].recordStatus;
                var updateRegion = await this.update(checkRegion[0]);
                this.history.addNewHistory({
                    status: "success",
                    operation: "update_region_record_status",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": updateRegion.id.toString(),
                        "name": checkRegion[0].name,
                        "recordstatus": checkRegion[0].recordStatus.toString(),
                    }
                }, param.req.user.username, param.sessionId)

                return {
                    continuePrompt: undefined,
                    toolName: "update_region_record_status"
                }
            }
        })

        // this.toolRegister.register({
        //     functionName: "change_region_parent",
        //     handler: async (param: any): Promise<RequestResult> => {
        //         if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
        //             this.history.addNewHistory({
        //                 status: "fault",
        //                 operation: "change_region_parent",
        //                 parameters: this.history.getParams(param),
        //                 result: {
        //                     errorMessage: messages.region.nameisrequired
        //                 }
        //             }, param.req.user.username, param.sessionId)
        //             throw new HttpException(messages.region.nameisrequired, HttpStatus.BAD_REQUEST);
        //         }

        //         var specification = new RegionSpecification(this.toolRegister.normalizingName(param.name).trim());
        //         var checkRegion = await this.getWithSpecification(specification);
        //         if (checkRegion.length < 1) {
        //             this.history.addNewHistory({
        //                 status: "fault",
        //                 operation: "change_region_parent",
        //                 parameters: this.history.getParams(param),
        //                 result: {
        //                     errorMessage: messages.region.notfound
        //                 }
        //             }, param.req.user.username, param.sessionId)
        //             throw new HttpException(messages.region.notfound, HttpStatus.BAD_REQUEST);
        //         }

        //         var specification = new RegionSpecification(this.toolRegister.normalizingName(param.parentname).trim());
        //         var parentcheckRegion = await this.getWithSpecification(specification);
        //         if (parentcheckRegion.length < 1) {
        //             this.history.addNewHistory({
        //                 status: "fault",
        //                 operation: "change_region_parent",
        //                 parameters: this.history.getParams(param),
        //                 result: {
        //                     errorMessage: messages.region.parentnamenotfound
        //                 }
        //             }, param.req.user.username, param.sessionId)
        //             throw new HttpException(messages.region.parentnamenotfound, HttpStatus.BAD_REQUEST);
        //         }

        //         checkRegion[0].parent = parentcheckRegion[0];
        //         var updateRegion = await this.update(checkRegion[0]);
        //         this.history.addNewHistory({
        //             status: "success",
        //             operation: "change_region_parent",
        //             parameters: this.history.getParams(param),
        //             result: {
        //                 "id": updateRegion.id.toString(),
        //                 "name": checkRegion[0].name,
        //                 "parentname": parentcheckRegion[0].name
        //             }
        //         }, param.req.user.username, param.sessionId)

        //         return {
        //             continuePrompt: undefined,
        //             toolName: "change_region_parent"
        //         }
        //     }
        // })

    }




    async findAllTrees(): Promise<RegionListDto[]> {
        const trees = await this.regionRepository.findAllTrees();
        return plainToInstance(RegionListDto, trees, { excludeExtraneousValues: true });
    }

    async findDescendants(id: number): Promise<RegionListDto> {
        const node = await this.regionRepository.findById(id);
        if (!node) throw new Error('Not Found');
        const tree = await this.regionRepository.findDescendants(id);
        return plainToInstance(RegionListDto, tree, { excludeExtraneousValues: true });
    }

    async updateChildrenDepth(id: number): Promise<void> {
        await this.regionRepository.updateChildrenDepth(id);
    }
}