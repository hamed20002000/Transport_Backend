import { forwardRef, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Categories } from 'src/domain/entities/Categories';
import { CategoryRepository } from 'src/infrastructure/repositories/admin/category.repository';
import { CategoryListDto, CreateCategoryDto, UpdateCategoryDto } from 'src/presentation/dtos/baseinfo/category-dto';
import { plainToInstance } from 'class-transformer';
import { RequestResult } from '../agent/types';
import { ContextManager } from '../agent/contextManager';
import { ToolRegister } from '../agent/toolRegister';
import messages from '../agent/localFiles/messages.json'
import { UsernameSpecification } from 'src/application/specifications/user/user-specifications';
import { UserService } from '../user/user.service';
import { CategorySpecification, CategoryUpdateSpecification } from 'src/application/specifications/admin/category-specifications';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { GenericMapper } from 'src/presentation/helpers/mapper-classes';

@Injectable()
export class CategoryService extends BaseService<Categories> {
    constructor(

        private readonly categoryRepository: CategoryRepository,
        private readonly history: ContextManager,
        private readonly toolRegister: ToolRegister,
        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,
    ) {
        super(categoryRepository);
    }

    onModuleInit() {
        this.toolRegister.register({
            functionName: "create_category",
            handler: async (param: any): Promise<RequestResult> => {

                if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "create_category",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.category.namerequired
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.category.namerequired, HttpStatus.BAD_REQUEST);
                }


                var categoryDto = new CreateCategoryDto();
                categoryDto.name = this.toolRegister.normalizingName(param.name);
                if( this.toolRegister.propIsExist(param.parentname)){
                var parentSpecification=new CategorySpecification(param.parentname.trim());
                var checkParentCategory = await this.getWithSpecification(parentSpecification);
                if(checkParentCategory.length<1){
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "create_category",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.category.parentnamenotfound
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.category.parentnamenotfound, HttpStatus.BAD_REQUEST);
                }
                 categoryDto.parentId=checkParentCategory.length>0?checkParentCategory[0].id:undefined
                }
                else{
                    categoryDto.parentId=null;
                }
                var user = param.req.user;
                const user_specification = new UsernameSpecification(user.username);
                var checkUser = await this.userService.getWithSpecification(user_specification, null,
                    {
                        id: true

                    });

                var specification = new CategorySpecification(categoryDto.name.trim());
                var checkCategory = await this.getWithSpecification(specification);
                if (checkCategory.length > 0) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "create_category",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.category.categoryexist
                        }
                    }, param.req.user.username,param.sessionId)

                    throw new HttpException(messages.category.categoryexist, HttpStatus.BAD_REQUEST);
                }

                var category = GenericMapper.toEntity(Categories, categoryDto);
                
                category.name = categoryDto.name.trim();
                category.depth = 0;
                category.createAt = new Date();
                category.recordStatus = recordStatus.Active;
                category.user = checkUser[0];
                if (categoryDto.parentId) {
                    var parentCategory = await this.getById(categoryDto.parentId);
                    if (parentCategory == null) {
                        throw new HttpException("The parent category not found", HttpStatus.NOT_FOUND);
                    }
                    category.depth = parentCategory.depth + 1;
                    category.parent = new Categories();
                    category.parent.id = categoryDto.parentId;
                } else {
                    category.parent = null;
                    category.depth = 0;
                }

                var createCategory = await this.add(category);
                var result = GenericMapper.toDto(CategoryListDto, createCategory, { excludeExtraneousValues: true });
                this.history.addNewHistory({
                    status: "success",
                    operation: "create_category",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": createCategory.id.toString(),
                        "name": createCategory.name,
                        "createAt": createCategory.createAt.toString(),
                        "recordStatus": createCategory.recordStatus.toString(),

                    }
                }, param.req.user.username,param.sessionId)

                return {
                    continuePrompt: undefined,
                    toolName: "create_category"
                }

            }
        })

        this.toolRegister.register({
            functionName: "update_category",
            handler: async (param: any): Promise<RequestResult> => {



                var categoryDto = new UpdateCategoryDto();
                categoryDto.newname = this.toolRegister.normalizingName(param.newname);

                var specification = new CategorySpecification(param.name);
                var checkCategory = await this.getWithSpecification(specification);
                if (checkCategory.length < 1) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_category",
                        parameters: {
                            "name": param.name
                        },
                        result: {
                            errorMessage: messages.category.categorynotfound
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.category.categorynotfound, HttpStatus.NOT_FOUND);
                }

                if(param.newparentname!=""&&param.newparentname!=undefined){
                     var parentspecification = new CategorySpecification(param.newparentname);
                var checkParentCategory = await this.getWithSpecification(parentspecification);
                if (checkParentCategory.length < 1) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_category",
                        parameters: {
                            "name": param.name,
                            "parentname":param.newparentname
                        },
                        result: {
                            errorMessage: messages.category.parentnamenotfound
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.category.parentnamenotfound, HttpStatus.NOT_FOUND);
                }
                checkCategory[0].parent=checkParentCategory[0];

                }


                checkCategory[0].name = this.toolRegister.normalizingName(param.newname)?.trim() ?? checkCategory[0].name;
                //checkCategory[0].code = categoryDto.code ?? checkCategory[0].code;
                if (param.newname != null && param.newname != undefined&&param.name?.trim()!=param.newname?.trim()) {
                    var updateSpecification = new CategoryUpdateSpecification(categoryDto.newname.trim(), categoryDto.id);
                    var checkCategoryForUpdate = await this.getWithSpecification(updateSpecification);
                    if (checkCategoryForUpdate.length > 0) {
                        this.history.addNewHistory({
                            status: "fault",
                            operation: "update_role",
                            parameters: {
                                "name": param.name
                            },
                            result: {
                                errorMessage: messages.category.categoryexist
                            }
                        }, param.req.user.username,param.sessionId)
                        throw new HttpException(messages.category.categoryexist, HttpStatus.BAD_REQUEST);
                    }
                }
                let oldDepth = checkCategory[0].depth;

                if (checkCategory[0].parent !== undefined) {
                    checkCategory[0].depth = checkCategory[0].parent.depth + 1;
                } else {
                    checkCategory[0].depth = 0;
                    checkCategory[0].parent = null;
                }

                // If depth changed, update all children recursively
                if (checkCategory[0].depth !== oldDepth) {
                    const updateChildrenDepth = async (parent: Categories, parentDepth: number) => {
                        if (parent.categories && parent.categories.length > 0) {
                            for (const child of parent.categories) {
                                child.depth = parentDepth + 1;
                                await this.update(child);
                                await updateChildrenDepth(child, child.depth);
                            }
                        }
                    };
                    // update child depth
                    this.updateChildrenDepth(categoryDto.id);

                }

                var updateCategory = await this.update(checkCategory[0]);
                var result = GenericMapper.toDto(CategoryListDto, updateCategory, { excludeExtraneousValues: true });

                this.history.addNewHistory({
                    status: "success",
                    operation: "update_category",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": updateCategory.id.toString(),
                        "name": updateCategory.name,
                        "newname": categoryDto.newname,
                        "createAt": updateCategory.createAt.toString(),
                        "recordStatus": updateCategory.recordStatus.toString(),
                    }
                }, param.req.user.username,param.sessionId)

                return {
                    continuePrompt: undefined,
                    toolName: "update_category"
                }

            }
        })


        this.toolRegister.register({
            functionName: "delete_category",
            handler: async (param: any): Promise<RequestResult> => {

                if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "deleteـcategory",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.category.namerequired
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.role.namerequired, HttpStatus.BAD_REQUEST);
                }


                var categoryDto = new CreateCategoryDto();
                categoryDto.name = this.toolRegister.normalizingName(param.name);


                var specification = new CategorySpecification(categoryDto.name);
                var checkRole = await this.getWithSpecification(specification);
                if (checkRole.length < 1) {
                    throw new HttpException(messages.category.categorynotfound, HttpStatus.NOT_FOUND);
                }

                var createRole = await this.delete(checkRole[0].id);
                this.history.addNewHistory({
                    status: "success",
                    operation: "delete_role",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": checkRole[0].id.toString(),
                        "name": categoryDto.name,
                    }
                }, param.req.user.username,param.sessionId)


                return {
                    continuePrompt: undefined,
                    toolName: "delete_category"
                };
            }
        })

        this.toolRegister.register({
            functionName: "update_category_record_status",
            handler: async (param: any): Promise<RequestResult> => {
                var categoryDto = new UpdateCategoryDto();
                categoryDto.recordStatus = param.recordStatus;

                if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_category_record_status",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.category.namerequired
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.category.namerequired, HttpStatus.BAD_REQUEST);
                }
                var specification = new CategorySpecification(param.name);
                var checkCategory = await this.getWithSpecification(specification);
                if (checkCategory.length < 1) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "update_category_record_status",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.category.categorynotfound
                        }
                    }, param.req.user.username,param.sessionId)

                    throw new HttpException(messages.role.rolenotfound, HttpStatus.NOT_FOUND);
                }
                checkCategory[0].recordStatus = categoryDto.recordStatus ?? checkCategory[0].recordStatus;

                var updateCategory = await this.update(checkCategory[0]);
                var result = GenericMapper.toDto(CategoryListDto, updateCategory, { excludeExtraneousValues: true });
                this.history.addNewHistory({
                    status: "success",
                    operation: "update_category_record_status",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": updateCategory.id.toString(),
                        "name": param.name,
                        "recordStatus": updateCategory.recordStatus.toString(),
                    }
                }, param.req.user.username,param.sessionId)

                return {
                    continuePrompt: undefined,
                    toolName: "update_category_record_status"
                };
            }
        })

        this.toolRegister.register({
            functionName: "change_category_parent",
            handler: async (param: any): Promise<RequestResult> => {
                var categoryDto = new UpdateCategoryDto();

                if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "change_category_parent",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.category.namerequired
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.role.namerequired, HttpStatus.BAD_REQUEST);
                }
                   if (param.parentname == undefined || param.parentname.replaceAll(" ", "") == "") {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "change_category_parent",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.category.parentnamerequired
                        }
                    }, param.req.user.username,param.sessionId)
                    throw new HttpException(messages.category.parentnamerequired, HttpStatus.BAD_REQUEST);
                }

                var specification = new CategorySpecification(param.name);
                var checkCategory = await this.getWithSpecification(specification);
                if (checkCategory.length < 1) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "change_category_parent",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.category.categorynotfound
                        }
                    }, param.req.user.username,param.sessionId)

                    throw new HttpException(messages.role.rolenotfound, HttpStatus.NOT_FOUND);
                }

                 var parentSpecification = new CategorySpecification(param.parentname);
                var parentCheckCategory = await this.getWithSpecification(parentSpecification);
                if (parentCheckCategory.length < 1) {
                    this.history.addNewHistory({
                        status: "fault",
                        operation: "change_category_parent",
                        parameters: this.history.getParams(param),
                        result: {
                            errorMessage: messages.category.parentnamenotfound
                        }
                    }, param.req.user.username,param.sessionId)

                    throw new HttpException(messages.category.parentnamenotfound, HttpStatus.NOT_FOUND);
                }
                checkCategory[0].parent=parentCheckCategory[0];

                var updateCategory = await this.update(checkCategory[0]);
                var result = GenericMapper.toDto(CategoryListDto, updateCategory, { excludeExtraneousValues: true });
                this.history.addNewHistory({
                    status: "success",
                    operation: "change_category_parent",
                    parameters: this.history.getParams(param),
                    result: {
                        "id": updateCategory.id.toString(),
                        "name": param.name,
                        "parentname":param.name
                    }
                }, param.req.user.username,param.sessionId)

                return {
                    continuePrompt: undefined,
                    toolName: "change_category_parent"
                };
            }
        })

    }




    async findAllTrees(): Promise<CategoryListDto[]> {
        const trees = await this.categoryRepository.findAllTrees();
        return plainToInstance(CategoryListDto, trees, { excludeExtraneousValues: true });
    }

    async findDescendants(id: number): Promise<CategoryListDto> {
        const node = await this.categoryRepository.findById(id);
        if (!node) throw new Error('Not Found');
        const tree = await this.categoryRepository.findDescendants(id);
        return plainToInstance(CategoryListDto, tree, { excludeExtraneousValues: true });
    }

    async updateChildrenDepth(id: number): Promise<void> {
        await this.categoryRepository.updateChildrenDepth(id);
    }

     async isCategory(name: string): Promise<Categories> {
       return await this.categoryRepository.findByName(name);

       
    }
}