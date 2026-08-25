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
                    }, param.req.user.username,param.sessionId)
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
                var parentSpecification = new RegionSpecification(this.toolRegister.normalizingName(param.parentname).trim());
                var parentCheckRegion = await this.getWithSpecification(parentSpecification);

                regionDto.name = this.toolRegister.normalizingName(param.name)
                if (param.parentname != "" && param.parentname != undefined) {
                    if (checkRegion.length < 1) {
                        this.history.addNewHistory({
                            status: "fault",
                            operation: "create_region",
                            parameters: this.history.getParams(param),
                            result: {
                                errorMessage: messages.region.parentnamenotfound
                            }
                        }, param.req.user.username,param.sessionId)
                        throw new HttpException(messages.region.parentnamenotfound, HttpStatus.BAD_REQUEST);
                    }

                    regionDto.parentId = parentCheckRegion[0].id;
                }

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
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.region.regionalreadyexists, HttpStatus.BAD_REQUEST);
                }
                var region = GenericMapper.toEntity(Regions, regionDto);
                region.name = regionDto.name.trim();
                region.depth = 0;
                region.createAt = new Date();
                region.recordStatus = recordStatus.Active;
                region.user = checkUser[0];
                if (regionDto.parentId) {

                    region.depth = parentCheckRegion[0].depth + 1;
                    region.parent = new Regions();
                    region.parent.id = regionDto.parentId;
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
                }, param.req.user.username,param.sessionId)

                return {
                    continuePrompt: undefined,
                    toolName: "create_region"
                }



            }
        })

        this.toolRegister.register({
            functionName: "update_region",
            handler: async (param: any): Promise<RequestResult> => {
                if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_region",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.region.nameisrequired
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.region.nameisrequired, HttpStatus.BAD_REQUEST);
                }



                var specification = new RegionSpecification(this.toolRegister.normalizingName(param.name).trim());
                var checkRegion = await this.getWithSpecification(specification);
                if (checkRegion.length > 0) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_region",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.region.notfound
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.region.notfound, HttpStatus.BAD_REQUEST);
                }

                const regionDto = new UpdateRegionDto();
                const regionName = this.toolRegister.normalizingName(param.name);
                regionDto.newname = this.toolRegister.normalizingName(param.newname)?.trim() ?? checkRegion[0].name;
                regionDto.parentId = checkRegion[0].parent.id;
                if (param.newname != null && param.newname != undefined) {
                    var updatespecification = new RegionUpdateSpecification(regionDto.newname.trim(), regionDto.id);
                    var checkRegionForUpdate = await this.getWithSpecification(updatespecification);
                    if (checkRegionForUpdate.length > 0) {

                        this.history.addNewHistory({
                            status: "fault",
                            operation: "update_region",
                            parameters: this.history.getParams(param),
                            result: {
                                errorMessage: messages.region.regionalreadyexists
                            }
                        }, param.req.user.username,param.sessionId)


                        throw new HttpException(messages.region.regionalreadyexists, HttpStatus.BAD_REQUEST);
                    }
                }
                let oldDepth = checkRegion[0].depth;

                if (regionDto.parentId !== undefined && regionDto.parentId !== null) {
                    var parentRegion = await this.getById(regionDto.parentId);
                    if (parentRegion == null) {
                        throw new HttpException("The parent region not found", HttpStatus.NOT_FOUND);
                    }
                    checkRegion[0].depth = parentRegion.depth + 1;
                    if (!checkRegion[0].parent) {
                        checkRegion[0].parent = new Regions();
                    }
                    checkRegion[0].parent.id = regionDto.parentId;
                } else {
                    checkRegion[0].depth = 0;
                    checkRegion[0].parent = null;
                }

                // If depth changed, update all children recursively
                if (checkRegion[0].depth !== oldDepth) {
                    const updateChildrenDepth = async (parent: Regions, parentDepth: number) => {
                        if (parent.regions && parent.regions.length > 0) {
                            for (const child of parent.regions) {
                                child.depth = parentDepth + 1;
                                await this.update(child);
                                await updateChildrenDepth(child, child.depth);
                            }
                        }
                    };
                    // update child depth
                    this.updateChildrenDepth(regionDto.id);

                }

                var updateRegion = await this.update(checkRegion[0]);



                this.history.addNewHistory({
                    status: "success",
                    operation: "update_region",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": updateRegion.id.toString(),
                        "name": param.newName,
                        "parentid": regionDto.parentId.toString(),
                    }
                }, param.req.user.username,param.sessionId)

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
                    }, param.req.user.username,param.sessionId)
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
                    }, param.req.user.username,param.sessionId)
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
                }, param.req.user.username,param.sessionId)


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
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.region.nameisrequired, HttpStatus.BAD_REQUEST);
                }

                var specification = new RegionSpecification(this.toolRegister.normalizingName(param.name).trim());
                var checkRegion = await this.getWithSpecification(specification);
                if (checkRegion.length <1) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_region_record_status",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.region.notfound
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.region.notfound, HttpStatus.BAD_REQUEST);
                }

                checkRegion[0].recordStatus = param.recordstatus??checkRegion[0].recordStatus;
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
                }, param.req.user.username,param.sessionId)

                return {
                    continuePrompt: undefined,
                    toolName: "update_region_record_status"
                }
            }
        })

          this.toolRegister.register({
            functionName: "change_region_parent",
            handler: async (param: any): Promise<RequestResult> => {
                         if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "change_region_parent",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.region.nameisrequired
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.region.nameisrequired, HttpStatus.BAD_REQUEST);
                }

                var specification = new RegionSpecification(this.toolRegister.normalizingName(param.name).trim());
                var checkRegion = await this.getWithSpecification(specification);
                if (checkRegion.length <1) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "change_region_parent",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.region.notfound
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.region.notfound, HttpStatus.BAD_REQUEST);
                }

                    var specification = new RegionSpecification(this.toolRegister.normalizingName(param.parentname).trim());
                var parentcheckRegion = await this.getWithSpecification(specification);
                if (parentcheckRegion.length <1) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "change_region_parent",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.region.parentnamenotfound
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.region.parentnamenotfound, HttpStatus.BAD_REQUEST);
                }

                checkRegion[0].parent = parentcheckRegion[0];
                var updateRegion = await this.update(checkRegion[0]);
                this.history.addNewHistory({
                    status: "success",
                    operation: "change_region_parent",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": updateRegion.id.toString(),
                        "name": checkRegion[0].name,
                        "parentname":parentcheckRegion[0].name
                    }
                }, param.req.user.username,param.sessionId)

                return {
                    continuePrompt: undefined,
                    toolName: "change_region_parent"
                }
            }
        })

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