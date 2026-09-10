import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpException, HttpStatus, Request, Put, BadRequestException, Req, UploadedFile, UseInterceptors, Delete, UploadedFiles } from '@nestjs/common';
import { UserService } from '../../../application/services/user/user.service';

import { Users } from 'src/domain/entities/Users';
import { CreateUserOperationsDto, CreateUserRolesDto, UserDto, UserUpdateDto } from '../../dtos/user/user.dto';
import { changePasswordDto, registerUserDto, resetPasswordDto } from '../../dtos/user/register-user.dto';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { GenericMapper } from '../../helpers/mapper-classes';
import { UsernameAndPasswordSpecification, UsernameSpecification, UserSpecification } from 'src/application/specifications/user/user-specifications';



import { PasswordService } from 'src/application/services/helper/password.service';
import { SkipThrottle, Throttle } from '@nestjs/throttler';

import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { CreateRoleDto, DeleteRoleDto, RoleListDto, UpdateRoleDto } from 'src/presentation/dtos/user/role.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AdminAndClientRolesGuard, AdminRolesGuard } from 'src/auth/guards/roles.guard';
import { RoleService } from 'src/application/services/user/role.service';
import { RoleIdsSpecification, RoleNamesSpecification, RoleSpecification } from 'src/application/specifications/user/role-specifications';
import { Roles } from 'src/domain/entities/Roles';
import { UserRoles } from 'src/domain/entities/UserRoles';
import { FindOptionsRelations, In } from 'typeorm';
import { CreateSystemOperationDto, SystemOperationListDto, UpdateSystemOperationDto } from 'src/presentation/dtos/user/system-opearion.dto';
import { SystemOperationService } from 'src/application/services/admin/system-operation.service';
import { SystemOperationSpecification, SystemOperationsSpecification } from 'src/application/specifications/admin/system-operation-specifications';
import { SystemOperations } from 'src/domain/entities/SystemOperations';
import { RoleMenuOperations } from 'src/domain/entities/RoleMenuOperations';

import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { fileUploadOptions } from 'src/interceptors/file-option';
import { generateSecurePassword } from 'src/application/services/helper/generate-password';
import { CategoryListDto, CreateCategoryDto, UpdateCategoryDto } from 'src/presentation/dtos/baseinfo/category-dto';
import { CategoryService } from 'src/application/services/admin/category.service';
import { CategorySpecification, CategoryUpdateSpecification } from 'src/application/specifications/admin/category-specifications';
import { Categories } from 'src/domain/entities/Categories';
import { CreateItemUnitDto, ItemUnitListDto, UpdateItemUnitDto } from 'src/presentation/dtos/baseinfo/item-unit.dto';
import { ItemUnitService } from 'src/application/services/admin/item-unit.service';
import { ItemUnitSpecification } from 'src/application/specifications/admin/item-unit-specifications';
import { ItemUnits } from 'src/domain/entities/ItemUnits';
import { CreateItemDto, ItemListDto, UpdateItemDto } from 'src/presentation/dtos/baseinfo/item.dto';
import { ItemService } from 'src/application/services/admin/item.service';
import { Items } from 'src/domain/entities/Items';
import { ItemAbbriviationSpecification, ItemCreateCheckAbbSpecification, ItemIdSpecification, ItemSpecification } from 'src/application/specifications/admin/item-specifications';
import { CreateMenuDto, CreateMenuOperationsDto, MenuListDto, UpdateMenuDto } from 'src/presentation/dtos/baseinfo/menu-dto';
import { MenuService } from 'src/application/services/admin/menu.servic';
import { MenuSpecification } from 'src/application/specifications/admin/menu-specifications';
import { Menus } from 'src/domain/entities/Menus';
import { MenuOperations } from 'src/domain/entities/MenuOperations';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { CreateRegionDto, RegionListDto, UpdateRegionDto } from 'src/presentation/dtos/baseinfo/region-dto';
import { RegionService } from 'src/application/services/admin/region.service';
import { Regions } from 'src/domain/entities/Regions';
import { RegionSpecification, RegionUpdateSpecification } from 'src/application/specifications/admin/region-specifications';
import { UploadFilesDto } from 'src/presentation/dtos/baseinfo/upload-dto';
import { Providers } from 'src/domain/entities/Providers';
import { ProviderService } from 'src/application/services/admin/provider.service';
import { CreateProviderDto, UpdateProviderDto } from 'src/presentation/dtos/baseinfo/provider.dto';
import { ProviderSpecification } from 'src/application/specifications/admin/provider-specifications';
import { SystemNotificationsService } from 'src/application/services/notificatin/systemNotifications.service';
import { SystemNotifications } from 'src/domain/entities/SystemNotifications';
import { SystemNotificationByForAllUpdateSpecification, SystemNotificationByForUpdateSpecification, SystemNotificationByRoleSpecification } from 'src/application/specifications/notification/system-notification-specifications';
import axios from 'axios';
import { ChatRequest, Tools } from 'src/agent/types';
import { http } from 'winston';
import { json } from 'stream/consumers';
import { InsertTools } from 'src/agent/tools/insert_tools';


import { mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { AgentSqlService } from 'src/application/services/agent/services/agentSql.service';
import { AgentToolsService } from 'src/application/services/agent/services/agentTools.service';
import { FunctionCallService } from 'src/application/services/agent/services/functioncall.service';
import { AgentGateway } from 'src/application/services/agent/agent.gateway';




@Controller('api/baseinfo')
export class BaseinfoController {
    constructor(
        private readonly categoryService: CategoryService,
        private readonly userService: UserService,
        private readonly itemUnitService: ItemUnitService,
        private readonly itemService: ItemService,
        private readonly menuService: MenuService,
        private readonly systemOperationService: SystemOperationService,
        private readonly regionService: RegionService,
        private readonly providerService: ProviderService,
        private readonly systemNotificationsService: SystemNotificationsService,
        private readonly insertTools: InsertTools,
        private readonly agentSqlService: AgentSqlService,
        private readonly agentToolsService: AgentToolsService,
        private readonly functioncall: FunctionCallService,
        private readonly agentGateway: AgentGateway,

    ) { }

    //#region Upload
    @Post('upload-files')
    @ApiTags('Upload')
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        description: 'Files to upload',
        type: UploadFilesDto,
    })
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: (req, file, callback) => {

                    const isImage = file.mimetype.startsWith('image/');

                    const folder = isImage
                        ? 'images'
                        : 'files';

                    const uploadPath = join(
                        process.cwd(),
                        'cdn',
                        folder,
                    );

                    // اگر پوشه وجود نداشت، ایجادش کن
                    mkdirSync(uploadPath, {
                        recursive: true,
                    });

                    callback(null, uploadPath);
                },

                filename: (req, file, callback) => {
                    const originalName = file.originalname.replace(/\.[^/.]+$/, '');
                    const extension = extname(file.originalname);
                    const now = new Date();
                    const timestamp = now.toISOString().replace(/[:.]/g, '-');
                    const newFilename = `${originalName}-${timestamp}${extension}`;
                    callback(null, newFilename);
                },
            }),
            fileFilter: (req, file, callback) => {
                const allowedMimes = [
                    'application/pdf',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/vnd.ms-excel',
                    'image/jpeg',
                    'image/png',
                    'image/jpg',
                    'image/webp',
                    'image/gif',
                    'image/heic',
                ];
                if (!allowedMimes.includes(file.mimetype)) {
                    return callback(
                        new BadRequestException('Only PDF , Excel and Image files are allowed'),
                        false,
                    );
                }
                callback(null, true);
            },
            limits: {
                fileSize: 10 * 1024 * 1024,
            },
        }),
    )
    @ApiBearerAuth()
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    async uploadFiles(@UploadedFile() file: Express.Multer.File) {


        const isImage = file.mimetype.startsWith('image/');

        const folder = isImage
            ? 'images'
            : 'files';

        const uploadPath = join(
            'cdn',
            folder,
        );
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }
        return {
            message: 'File uploaded successfully',
            files: `/${uploadPath}/${file.filename}`,
        };
    }


    @Get("test")
    test() {
        return "OK";
    }


    @Post("agent")
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @UseInterceptors(FilesInterceptor("files", 10))
    @ApiBearerAuth()
    async agent(@Request() req, @Body("prompt") text: string, @Body("files") files: string[], @Body("sessionId") sessionId: string): Promise<any> {

        //#region ----------------- Exctract Prompt
        const prompt = text?.trim() || 'nothink';
        this.agentGateway.sendCurrentTool(req.user.userid, {
            currentOp: `Komut türünün işlenmesi`
        })
        //#endregion ------------------------------- 


        //#region ----------------- Determine Type of Prompt
        const sqlOrFunctionCall = await this.agentToolsService.FunctionCallingOrSqlSelection(prompt);
        this.functioncall.source = "web"

        switch (sqlOrFunctionCall) {
            case "functionCalling":
                this.functioncall.RunFunctionCalling(prompt, req, files, sessionId).catch(error => {
                    console.error(error);
                });
                return {
                    result: "started"
                }
            case "sql":
                this.agentGateway.sendToolResult(req.user.userid, {
                    result: "error",
                    message: "İstek belirsiz. Lütfen düzeltin.",
                    prompt: "",
                    continuePrompt: undefined,
                    toolName: "",
                    lastsegment: true,
                    isSpecial: false,
                    list: []
                })
                break;
        }
        //#endregion --------------------------------------------

    }



    //#endregion upload
    //#region Menus
    @Get("get-menus")
    @ApiTags('Menus')
    @ApiOperation({ summary: 'Menu list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return Menu list.', type: Menus })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getMenus(): Promise<Menus[]> {
        const menus = await this.menuService.findAllTreesWithOperations();
        /*  let result = GenericMapper.toDtoList(MenuListDto, menus, { excludeExtraneousValues: true });
     
         // Set parentId for each menu in the result
         const setParentId = (items: MenuListDto[], parentId: number | null = null) => {
             for (const item of items) {
                 item.parentId = parentId;
                 if (item.menus && item.menus.length > 0) {
                     setParentId(item.menus, item.id);
                 }
             }
         };
     
         setParentId(result); */

        return menus;
    }
    @Get("get-menu-by-id/:id")
    @ApiTags('Menus')
    @ApiOperation({ summary: 'Menu' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return menu.', type: Menus })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getMenuById(@Param('id') id: number): Promise<Menus> {
        const menus = await this.menuService.findDescendantsWithOperations(id);
        //let result = GenericMapper.toDto(MenuListDto, menus, { excludeExtraneousValues: true });
        /* 
                // Set parentId for each menu in the result
                const setParentId = (items: MenuListDto[], parentId: number | null = null) => {
                    for (const item of items) {
                        item.parentId = parentId;
                        if (item.menus && item.menus.length > 0) {
                            setParentId(item.menus, item.id);
                        }
                    }
                };
        
                setParentId([result]); */

        return menus;
    }
    @Post("create-menu")
    @ApiTags('Menus')
    @ApiOperation({ summary: 'new menu' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return menu .', type: MenuListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewMenu(@Body() menuDto: CreateMenuDto, @Request() req): Promise<MenuListDto> {
        var user = req.user;
        const user_specification = new UsernameSpecification(user.username);
        var checkUser = await this.userService.getWithSpecification(user_specification, null,
            {
                id: true

            });
        var specification = new MenuSpecification(menuDto.name.trim());
        var checkMenu = await this.menuService.getWithSpecification(specification);
        if (checkMenu.length > 0) {
            throw new HttpException("The menu already exist", HttpStatus.BAD_REQUEST);
        }
        var menu = GenericMapper.toEntity(Menus, menuDto);
        menu.name = menuDto.name.trim();
        menu.icon = menuDto.icon;
        menu.url = menuDto.url;
        menu.order = menuDto.order;
        menu.depth = 0;
        menu.createAt = new Date();
        menu.recordStatus = recordStatus.Active;
        menu.user = checkUser[0];
        if (menuDto.parentId) {
            var parentMenu = await this.menuService.getById(menuDto.parentId);
            if (parentMenu == null) {
                throw new HttpException("The parent menu not found", HttpStatus.NOT_FOUND);
            }
            menu.depth = parentMenu.depth + 1;
            menu.parent = new Menus();
            menu.parent.id = menuDto.parentId;
        } else {
            menu.parent = null;
            menu.depth = 0;
        }

        var createMenu = await this.menuService.add(menu);
        var result = GenericMapper.toDto(MenuListDto, createMenu, { excludeExtraneousValues: true });
        return result;
    }

    @Post("assign-menu-operations")
    @ApiTags('Menus')
    @ApiOperation({ summary: 'Assign system operations to a menu' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Assigned operations to menu.', type: MenuListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async assignMenuOperation(@Body() dto: CreateMenuOperationsDto, @Request() req): Promise<MenuListDto> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);
        const checkUser = await this.userService.getWithSpecification(user_specification, null, { id: true });
        if (!checkUser || checkUser.length === 0) {
            throw new HttpException("User not found", HttpStatus.NOT_FOUND);
        }

        // بررسی وجود Menu
        const menu = await this.menuService.getById(dto.menuId);
        if (!menu) {
            throw new HttpException("Menu not found", HttpStatus.NOT_FOUND);
        }

        // بررسی وجود MenuOperationها
        const operations = await this.systemOperationService.getWithSpecification(
            new SystemOperationsSpecification(dto.OperationIds)

        );
        if (!operations || operations.length !== dto.OperationIds.length) {
            throw new HttpException("Some system operations not found", HttpStatus.BAD_REQUEST);
        }

        // ساخت RoleMenuOperations برای هر operation
        const items: MenuOperations[] = [];
        for (const op of operations) {
            const item = new MenuOperations();
            item.menu = menu;
            item.systemOperation = op;
            item.user = checkUser[0];
            item.createAt = new Date();
            item.recordStatus = recordStatus.Active;
            items.push(item);
        }

        // ذخیره ارتباطات (فرض بر اینکه roleService متد مناسب دارد)
        await this.menuService.assignOperationsToMenu(dto.menuId, items);

        const menuWithOperations = await this.menuService.getMenuWithOperations(menu.id);

        const result = GenericMapper.toDto(MenuListDto, menuWithOperations, { excludeExtraneousValues: true });
        result.systemOperations = (menuWithOperations.menuOperations || [])
            .map(mo => mo.systemOperation);
        return result;

    }
    @Get("get-menu-with-operations/:id")
    @ApiTags('Menus')
    @ApiOperation({ summary: 'Get menu with operations' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Menu with operations found.', type: MenuListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async getMenuWithOperation(@Param('id') id: number): Promise<MenuListDto> {

        // بررسی وجود Menu
        const menu = await this.menuService.getById(id);
        if (!menu) {
            throw new HttpException("Menu not found", HttpStatus.NOT_FOUND);
        }
        const menuWithOperations = await this.menuService.getMenuWithOperations(menu.id);
        const result = GenericMapper.toDto(MenuListDto, menuWithOperations, { excludeExtraneousValues: true });
        result.systemOperations = (menuWithOperations.menuOperations || [])
            .map(mo => mo.systemOperation);
        return result;

    }

    @Put("update-menu")
    @ApiTags('Menus')
    @ApiOperation({ summary: 'update menu' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return menu .', type: MenuListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateMenu(@Body() menuDto: UpdateMenuDto): Promise<MenuListDto> {


        var checkMenu = await this.menuService.getById(menuDto.id);
        if (checkMenu == null) {
            throw new HttpException("The menu is not found!", HttpStatus.NOT_FOUND);
        }
        checkMenu.name = menuDto.newname?.trim() ?? checkMenu.name;
        if (menuDto.newname != null && menuDto.newname != undefined) {
            var specification = new MenuSpecification(menuDto.newname.trim());
            var checkMenuForUpdate = await this.menuService.getWithSpecification(specification);
            if (checkMenuForUpdate.length > 0) {
                throw new HttpException("The menu already exist", HttpStatus.BAD_REQUEST);
            }
        }
        let oldDepth = checkMenu.depth;

        if (menuDto.parentId !== undefined && menuDto.parentId !== null) {
            var parentMenu = await this.menuService.getById(menuDto.parentId);
            if (parentMenu == null) {
                throw new HttpException("The parent menu not found", HttpStatus.NOT_FOUND);
            }
            checkMenu.depth = parentMenu.depth + 1;
            if (!checkMenu.parent) {
                checkMenu.parent = new Menus();
            }
            checkMenu.parent.id = menuDto.parentId;
        } else {
            checkMenu.depth = 0;
            checkMenu.parent = null;
        }

        // If depth changed, update all children recursively
        if (checkMenu.depth !== oldDepth) {
            const updateChildrenDepth = async (parent: Menus, parentDepth: number) => {
                if (parent.menus && parent.menus.length > 0) {
                    for (const child of parent.menus) {
                        child.depth = parentDepth + 1;
                        await this.menuService.update(child);
                        await updateChildrenDepth(child, child.depth);
                    }
                }
            };
            // update child depth
            this.menuService.updateChildrenDepth(menuDto.id);

        }
        checkMenu.recordStatus = menuDto.recordStatus ?? checkMenu.recordStatus;
        checkMenu.icon = menuDto.icon ?? checkMenu.icon;
        checkMenu.url = menuDto.url ?? checkMenu.url;
        checkMenu.order = menuDto.order ?? checkMenu.order;
        var updateMenu = await this.menuService.update(checkMenu);
        var result = GenericMapper.toDto(MenuListDto, updateMenu, { excludeExtraneousValues: true });
        return result;
    }
    @Delete("delete-menu/:id")
    @ApiTags('Menus')
    @ApiOperation({ summary: 'remove Menus' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfull.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteMenu(@Param('id') id: number): Promise<boolean> {

        var checkMenu = await this.menuService.getById(id);
        if (checkMenu == null) {
            throw new HttpException("The menu is not found!", HttpStatus.NOT_FOUND);
        }

        await this.menuService.delete(id);
        return true;
    }
    //#endregion 

    //#region Categories
    @Get("get-categories")
    @ApiTags('Categories')
    @ApiOperation({ summary: 'Category list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return category list.', type: CategoryListDto })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getCategories(): Promise<CategoryListDto[]> {
        const categories = await this.categoryService.findAllTrees();
        let result = GenericMapper.toDtoList(CategoryListDto, categories, { excludeExtraneousValues: true });

        // Set parentId for each category in the result
        const setParentId = (items: CategoryListDto[], parentId: number | null = null) => {
            for (const item of items) {
                item.parentId = parentId;
                if (item.categories && item.categories.length > 0) {
                    setParentId(item.categories, item.id);
                }
            }
        };

        setParentId(result);

        return result;
    }
    @Get("get-category-by-id/:id")
    @ApiTags('Categories')
    @ApiOperation({ summary: 'Category' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return category.', type: CategoryListDto })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getCategoryById(@Param('id') id: number): Promise<CategoryListDto> {
        const categories = await this.categoryService.findDescendants(id);
        let result = GenericMapper.toDto(CategoryListDto, categories, { excludeExtraneousValues: true });

        // Set parentId for each category in the result
        const setParentId = (items: CategoryListDto[], parentId: number | null = null) => {
            for (const item of items) {
                item.parentId = parentId;
                if (item.categories && item.categories.length > 0) {
                    setParentId(item.categories, item.id);
                }
            }
        };

        setParentId([result]);

        return result;
    }
    @Post("create-category")
    @ApiTags('Categories')
    @ApiOperation({ summary: 'new category' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return category .', type: CategoryListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewCategory(@Body() categoryDto: CreateCategoryDto, @Request() req): Promise<CategoryListDto> {
        var user = req.user;
        const user_specification = new UsernameSpecification(user.username);
        var checkUser = await this.userService.getWithSpecification(user_specification, null,
            {
                id: true

            });
        var specification = new CategorySpecification(categoryDto.name.trim());
        var checkCategory = await this.categoryService.getWithSpecification(specification);
        if (checkCategory.length > 0) {
            throw new HttpException("The category already exist", HttpStatus.BAD_REQUEST);
        }
        var category = GenericMapper.toEntity(Categories, categoryDto);
        category.name = categoryDto.name.trim();
        category.depth = 0;
        category.createAt = new Date();
        category.recordStatus = recordStatus.Active;
        category.user = checkUser[0];
        if (categoryDto.parentId) {
            var parentCategory = await this.categoryService.getById(categoryDto.parentId);
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

        var createCategory = await this.categoryService.add(category);
        var result = GenericMapper.toDto(CategoryListDto, createCategory, { excludeExtraneousValues: true });
        return result;
    }
    @Put("update-category")
    @ApiTags('Categories')
    @ApiOperation({ summary: 'update category' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return category .', type: CategoryListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateCategory(@Body() categoryDto: UpdateCategoryDto): Promise<CategoryListDto> {


        var checkCategory = await this.categoryService.getById(categoryDto.id);
        if (checkCategory == null) {
            throw new HttpException("The category is not found!", HttpStatus.NOT_FOUND);
        }
        checkCategory.name = categoryDto.newname?.trim() ?? checkCategory.name;
        checkCategory.code = categoryDto.code ?? checkCategory.code;
        if (categoryDto.newname != null && categoryDto.newname != undefined) {
            var specification = new CategoryUpdateSpecification(categoryDto.newname.trim(), categoryDto.id);
            var checkCategoryForUpdate = await this.categoryService.getWithSpecification(specification);
            if (checkCategoryForUpdate.length > 0) {
                throw new HttpException("The category already exist", HttpStatus.BAD_REQUEST);
            }
        }
        let oldDepth = checkCategory.depth;

        if (categoryDto.parentId !== undefined && categoryDto.parentId !== null) {
            var parentCategory = await this.categoryService.getById(categoryDto.parentId);
            if (parentCategory == null) {
                throw new HttpException("The parent category not found", HttpStatus.NOT_FOUND);
            }
            checkCategory.depth = parentCategory.depth + 1;
            if (!checkCategory.parent) {
                checkCategory.parent = new Categories();
            }
            checkCategory.parent.id = categoryDto.parentId;
        } else {
            checkCategory.depth = 0;
            checkCategory.parent = null;
        }

        // If depth changed, update all children recursively
        if (checkCategory.depth !== oldDepth) {
            const updateChildrenDepth = async (parent: Categories, parentDepth: number) => {
                if (parent.categories && parent.categories.length > 0) {
                    for (const child of parent.categories) {
                        child.depth = parentDepth + 1;
                        await this.categoryService.update(child);
                        await updateChildrenDepth(child, child.depth);
                    }
                }
            };
            // update child depth
            this.categoryService.updateChildrenDepth(categoryDto.id);

        }
        checkCategory.recordStatus = categoryDto.recordStatus ?? checkCategory.recordStatus;

        var updateCategory = await this.categoryService.update(checkCategory);
        var result = GenericMapper.toDto(CategoryListDto, updateCategory, { excludeExtraneousValues: true });
        return result;
    }
    @Delete("delete-category/:id")
    @ApiTags('Categories')
    @ApiOperation({ summary: 'remove Categories' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfull.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteCategory(@Param('id') id: number): Promise<boolean> {

        var checkCategory = await this.categoryService.getById(id);
        if (checkCategory == null) {
            throw new HttpException("The category is not found!", HttpStatus.NOT_FOUND);
        }

        await this.categoryService.delete(id);
        return true;
    }
    //#endregion 

    //#region Item units
    @Get("get-item-units")
    @ApiTags('Item Units')
    @ApiOperation({ summary: 'Item units list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return item unit list.', type: ItemUnitListDto })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getItemUnits(): Promise<ItemUnitListDto[]> {

        var operations = await this.itemUnitService.getAllRecords();
        var result = GenericMapper.toDtoList(ItemUnitListDto, operations, { excludeExtraneousValues: true });
        return result;
    }
    @Get("get-item-unit-by-id/:id")
    @ApiTags('Item Units')
    @ApiOperation({ summary: 'Item unit details' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return item unit details.', type: ItemUnitListDto })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getItemUnitById(@Param('id') id: number): Promise<ItemUnitListDto> {

        var operations = await this.itemUnitService.getById(id);
        var result = GenericMapper.toDto(ItemUnitListDto, operations, { excludeExtraneousValues: true });

        return result;
    }
    @Post("create-item-unit")
    @ApiTags('Item Units')
    @ApiOperation({ summary: 'new item unit' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return item unit .', type: ItemUnitListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewItemUnit(@Body() itemUnitDto: CreateItemUnitDto, @Request() req): Promise<ItemUnitListDto> {

        var user = req.user;
        const user_specification = new UsernameSpecification(user.username);
        var checkUser = await this.userService.getWithSpecification(user_specification, null,
            {
                id: true

            });
        var specification = new ItemUnitSpecification(itemUnitDto.title.trim());
        var check = await this.itemUnitService.getWithSpecification(specification);
        if (check.length > 0) {
            throw new HttpException("The item unit already exist", HttpStatus.BAD_REQUEST);
        }
        var item = GenericMapper.toEntity(ItemUnits, itemUnitDto);
        item.title = itemUnitDto.title.trim();
        item.createAt = new Date();
        item.recordStatus = recordStatus.Active;
        item.user = checkUser[0];

        var createdItem = await this.itemUnitService.add(item);
        var result = GenericMapper.toDto(ItemUnitListDto, createdItem, { excludeExtraneousValues: true });
        return result;
    }
    @Put("update-item-unit")
    @ApiTags('Item Units')
    @ApiOperation({ summary: 'update item unit' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return item unit .', type: ItemUnitListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateItemUnit(@Body() itemUnitDto: UpdateItemUnitDto): Promise<ItemUnitListDto> {


        var checkItemUnit = await this.itemUnitService.getById(itemUnitDto.id);
        if (!checkItemUnit) {
            throw new HttpException("The item unit is not found!", HttpStatus.NOT_FOUND);
        }

        if (itemUnitDto?.newTitle != null && itemUnitDto?.newTitle != undefined) {
            var specification = new ItemUnitSpecification(itemUnitDto.newTitle.trim());
            var check = await this.itemUnitService.getWithSpecification(specification);
            if (check.length > 0) {
                throw new HttpException("The item unit already exist", HttpStatus.BAD_REQUEST);
            }
            checkItemUnit.title = itemUnitDto?.newTitle.trim() ?? checkItemUnit.title;
        }


        checkItemUnit.recordStatus = itemUnitDto.recordStatus ?? checkItemUnit.recordStatus;
        var updateItmeUnit = await this.itemUnitService.update(checkItemUnit);
        var result = GenericMapper.toDto(ItemUnitListDto, updateItmeUnit, { excludeExtraneousValues: true });
        return result;
    }
    @Delete("delete-item-unit/:id")
    @ApiTags('Item Units')
    @ApiOperation({ summary: 'remove item unit' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfull.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteItemUnit(@Param('id') id: number): Promise<boolean> {


        var chekItemUnit = await this.itemUnitService.getById(id);
        if (!chekItemUnit) {
            throw new HttpException("The item unit is not found!", HttpStatus.NOT_FOUND);
        }

        await this.itemUnitService.delete(chekItemUnit.id);
        return true;
    }
    //#endregion 

    //#region Item 
    @Get("get-item")
    @ApiTags('Items')
    @ApiOperation({ summary: 'Item list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return item list.', type: ItemListDto })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getItems(): Promise<ItemListDto[]> {

        var operations = await this.itemService.getWithSpecification(null, null, null, { category: true, unit: true });
        var result = GenericMapper.toDtoList(ItemListDto, operations, { excludeExtraneousValues: true });
        result.forEach(item => {
            const original = operations.find(i => i.id === item.id);
            item.category = original?.category;
            item.unit = original?.unit;
            item.weight = original?.weghit;
        });
        return result;
    }
    @Get("get-item-by-id/:id")
    @ApiTags('Items')
    @ApiOperation({ summary: 'Item' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return item.', type: ItemListDto })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getItemById(@Param('id') id: number): Promise<ItemListDto> {
        var specification = new ItemIdSpecification(id);

        var operations = await this.itemService.getWithSpecification(specification, null, null, { category: true, unit: true });
        var result = GenericMapper.toDtoList(ItemListDto, operations, { excludeExtraneousValues: true });
        result.forEach(item => {
            const original = operations.find(i => i.id === item.id);
            item.category = original?.category;
            item.unit = original?.unit;
            item.weight = original?.weghit;
        });
        return result[0];
    }

    @Post("create-item")
    @ApiTags('Items')
    @ApiOperation({ summary: 'new item' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return item .', type: ItemListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewItem(@Body() itemDto: CreateItemDto, @Request() req): Promise<ItemListDto> {

        var user = req.user;
        const user_specification = new UsernameSpecification(user.username);
        var checkUser = await this.userService.getWithSpecification(user_specification, null,
            {
                id: true

            });
        var specification = new ItemSpecification(itemDto.name.trim());
        var check = await this.itemService.getWithSpecification(specification);
        if (check.length > 0) {
            throw new HttpException("The item  already exist", HttpStatus.BAD_REQUEST);
        }
        if (itemDto.abbreviation != null && itemDto.abbreviation != undefined) {
            var abb_specification = new ItemCreateCheckAbbSpecification(itemDto.abbreviation.trim());
            var checkAbb = await this.itemService.getWithSpecification(abb_specification);
            if (checkAbb.length > 0) {
                throw new HttpException("The item with this abbriviation already exist", HttpStatus.BAD_REQUEST);
            }
        }
        var item = GenericMapper.toEntity(Items, itemDto);
        item.name = itemDto.name.trim();
        item.category = new Categories();
        item.category.id = itemDto.categoryId;

        item.unit = new ItemUnits();
        item.unit.id = itemDto.itemUnitId;
        item.weghit = itemDto.weight;
        item.createAt = new Date();
        item.recordStatus = recordStatus.Active;
        item.user = checkUser[0];

        var createdItem = await this.itemService.add(item);
        var result = GenericMapper.toDto(ItemListDto, createdItem, { excludeExtraneousValues: true });
        return result;
    }
    @Put("update-item")
    @ApiTags('Items')
    @ApiOperation({ summary: 'update item' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return item  .', type: ItemListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateItem(@Body() itemDto: UpdateItemDto): Promise<ItemListDto> {

        var specification = new ItemIdSpecification(itemDto.id);
        var checkItem = await this.itemService.getWithSpecification(specification, null, null, { category: true, unit: true });
        if (checkItem.length == 0) {
            throw new HttpException("The item  is not found!", HttpStatus.NOT_FOUND);
        }

        /*      if (itemDto.newName != null && itemDto.newName != undefined) {
                 var updateSpecification = new ItemSpecification(itemDto.newName.trim());
                 var check = await this.itemService.getWithSpecification(updateSpecification);
                 if (check.length > 0) {
                     throw new HttpException("The item  already exist", HttpStatus.BAD_REQUEST);
                 }
             } */

        checkItem[0].name = itemDto.newName?.trim() ?? checkItem[0].name;
        checkItem[0].code = itemDto.code ?? checkItem[0].code;
        checkItem[0].weghit = itemDto.weight ?? checkItem[0].weghit;
        checkItem[0].description = itemDto.description ?? checkItem[0].description;
        if (itemDto.abbreviation != null && itemDto.abbreviation != undefined) {
            var abbSpecification = new ItemAbbriviationSpecification(itemDto.abbreviation.trim(), itemDto.id);
            var check = await this.itemService.getWithSpecification(abbSpecification);
            if (check.length > 0) {
                throw new HttpException("The item with this abbriviation already exist", HttpStatus.BAD_REQUEST);
            }
        }
        checkItem[0].abbreviation = itemDto.abbreviation ?? checkItem[0].abbreviation;
        if (itemDto.categoryId) {
            checkItem[0].category = new Categories();
            checkItem[0].category.id = itemDto.categoryId;
        }
        if (itemDto.itemUnitId) {
            checkItem[0].unit = new ItemUnits();
            checkItem[0].unit.id = itemDto.itemUnitId;
        }

        checkItem[0].recordStatus = itemDto.recordStatus ?? checkItem[0].recordStatus;
        var updateItme = await this.itemService.update(checkItem[0]);
        checkItem = await this.itemService.getWithSpecification(
            specification,
            null,
            null,
            { category: true, unit: true }
        );
        var result = GenericMapper.toDto(ItemListDto, updateItme, { excludeExtraneousValues: true });


        result.category = checkItem[0]?.category;
        result.unit = checkItem[0]?.unit;

        return result;
    }
    @Delete("delete-item/:id")
    @ApiTags('Items')
    @ApiOperation({ summary: 'remove item ' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfull.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteItem(@Param('id') id: number): Promise<boolean> {


        var chekItem = await this.itemService.getById(id);
        if (!chekItem) {
            throw new HttpException("The item  is not found!", HttpStatus.NOT_FOUND);
        }

        await this.itemService.delete(chekItem.id);
        return true;
    }
    //#endregion 


    //#region Regions
    @Get("get-regions")
    @ApiTags('Regions')
    @ApiOperation({ summary: 'Region list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return region list.', type: RegionListDto })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getRegions(): Promise<RegionListDto[]> {
        const regions = await this.regionService.findAllTrees();
        let result = GenericMapper.toDtoList(RegionListDto, regions, { excludeExtraneousValues: true });

        // Set parentId for each region in the result
        const setParentId = (items: RegionListDto[], parentId: number | null = null) => {
            for (const item of items) {
                item.parentId = parentId;
                if (item.regions && item.regions.length > 0) {
                    setParentId(item.regions, item.id);
                }
            }
        };

        setParentId(result);

        return result;
    }
    @Get("get-region-by-id/:id")
    @ApiTags('Regions')
    @ApiOperation({ summary: 'Region' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return region.', type: RegionListDto })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getRegionById(@Param('id') id: number): Promise<RegionListDto> {
        const regions = await this.regionService.findDescendants(id);
        let result = GenericMapper.toDto(RegionListDto, regions, { excludeExtraneousValues: true });

        // Set parentId for each region in the result
        const setParentId = (items: RegionListDto[], parentId: number | null = null) => {
            for (const item of items) {
                item.parentId = parentId;
                if (item.regions && item.regions.length > 0) {
                    setParentId(item.regions, item.id);
                }
            }
        };

        setParentId([result]);

        return result;
    }
    @Post("create-region")
    @ApiTags('Regions')
    @ApiOperation({ summary: 'new region' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return region .', type: RegionListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewRegion(@Body() regionDto: CreateRegionDto, @Request() req): Promise<RegionListDto> {
        var user = req.user;
        const user_specification = new UsernameSpecification(user.username);
        var checkUser = await this.userService.getWithSpecification(user_specification, null,
            {
                id: true

            });
        var specification = new RegionSpecification(regionDto.name.trim());
        var checkRegion = await this.regionService.getWithSpecification(specification);
        if (checkRegion.length > 0) {
            throw new HttpException("The region already exist", HttpStatus.BAD_REQUEST);
        }
        var region = GenericMapper.toEntity(Regions, regionDto);
        region.name = regionDto.name.trim();
        region.depth = 0;
        region.createAt = new Date();
        region.recordStatus = recordStatus.Active;
        region.user = checkUser[0];
        if (regionDto.parentId) {
            var parentRegion = await this.regionService.getById(regionDto.parentId);
            if (parentRegion == null) {
                throw new HttpException("The parent region not found", HttpStatus.NOT_FOUND);
            }
            region.depth = parentRegion.depth + 1;
            region.parent = new Regions();
            region.parent.id = regionDto.parentId;
        } else {
            region.parent = null;
            region.depth = 0;
        }

        var createRegion = await this.regionService.add(region);
        var result = GenericMapper.toDto(RegionListDto, createRegion, { excludeExtraneousValues: true });
        return result;
    }
    @Put("update-region")
    @ApiTags('Regions')
    @ApiOperation({ summary: 'update region' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return region .', type: RegionListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateRegion(@Body() regionDto: UpdateRegionDto): Promise<RegionListDto> {


        var checkRegion = await this.regionService.getById(regionDto.id);
        if (checkRegion == null) {
            throw new HttpException("The region is not found!", HttpStatus.NOT_FOUND);
        }
        checkRegion.name = regionDto.newname?.trim() ?? checkRegion.name;

        if (regionDto.newname != null && regionDto.newname != undefined) {
            var specification = new RegionUpdateSpecification(regionDto.newname.trim(), regionDto.id);
            var checkRegionForUpdate = await this.regionService.getWithSpecification(specification);
            if (checkRegionForUpdate.length > 0) {
                throw new HttpException("The region already exist", HttpStatus.BAD_REQUEST);
            }
        }
        let oldDepth = checkRegion.depth;

        if (regionDto.parentId !== undefined && regionDto.parentId !== null) {
            var parentRegion = await this.regionService.getById(regionDto.parentId);
            if (parentRegion == null) {
                throw new HttpException("The parent region not found", HttpStatus.NOT_FOUND);
            }
            checkRegion.depth = parentRegion.depth + 1;
            if (!checkRegion.parent) {
                checkRegion.parent = new Regions();
            }
            checkRegion.parent.id = regionDto.parentId;
        } else {
            checkRegion.depth = 0;
            checkRegion.parent = null;
        }

        // If depth changed, update all children recursively
        if (checkRegion.depth !== oldDepth) {
            const updateChildrenDepth = async (parent: Regions, parentDepth: number) => {
                if (parent.regions && parent.regions.length > 0) {
                    for (const child of parent.regions) {
                        child.depth = parentDepth + 1;
                        await this.regionService.update(child);
                        await updateChildrenDepth(child, child.depth);
                    }
                }
            };
            // update child depth
            this.regionService.updateChildrenDepth(regionDto.id);

        }
        checkRegion.recordStatus = regionDto.recordStatus ?? checkRegion.recordStatus;

        var updateRegion = await this.regionService.update(checkRegion);

        var result = GenericMapper.toDto(RegionListDto, updateRegion, { excludeExtraneousValues: true });
        return result;
    }
    @Delete("delete-region/:id")
    @ApiTags('Regions')
    @ApiOperation({ summary: 'remove Regions' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfull.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteRegion(@Param('id') id: number): Promise<boolean> {

        var checkRegion = await this.regionService.getById(id);
        if (checkRegion == null) {
            throw new HttpException("The region is not found!", HttpStatus.NOT_FOUND);
        }

        await this.regionService.delete(id);
        return true;
    }
    //#endregion 

    //#region Provider
    @Get("get-provider")
    @ApiTags('Providers')
    @ApiOperation({ summary: 'Providers list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return provider list.', type: Providers })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getProviders(): Promise<Providers[]> {

        var operations = await this.providerService.getWithSpecification(null, null, null, { region: true });

        return operations;
    }
    @Get("get-provider/:id")
    @ApiTags('Providers')
    @ApiOperation({ summary: 'Provider' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return provider.', type: Providers })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getProviderById(@Param('id') id: number): Promise<Providers> {

        var spec = new ProviderSpecification(id);
        var operations = await this.providerService.getWithSpecification(spec, null, null, { region: true });

        return operations[0];
    }
    @Post("create-provider")
    @ApiTags('Providers')
    @ApiOperation({ summary: 'new provider' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return provider .', type: Providers })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewProvider(@Body() providerDto: CreateProviderDto, @Request() req): Promise<Providers> {

        var user = req.user;
        const user_specification = new UsernameSpecification(user.username);
        var checkUser = await this.userService.getWithSpecification(user_specification, null,
            {
                id: true

            });

        var item = GenericMapper.toEntity(Providers, providerDto);
        item.region = { id: providerDto.regionId } as Regions;
        item.createAt = new Date();
        item.recordStatus = recordStatus.Active;
        item.user = checkUser[0];

        var createdItem = await this.providerService.add(item);

        return createdItem;
    }
    @Put("update-provider")
    @ApiTags('Providers')
    @ApiOperation({ summary: 'update provider' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return provider .', type: Providers })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateProvider(@Body() providerDto: UpdateProviderDto): Promise<Providers> {


        var checkProvider = await this.providerService.getById(providerDto.id);
        if (!checkProvider) {
            throw new HttpException("The provider is not found!", HttpStatus.NOT_FOUND);
        }

        checkProvider.name = providerDto.name ?? checkProvider.name;
        checkProvider.address = providerDto.address ?? checkProvider.address;
        checkProvider.phone = providerDto.phone ?? checkProvider.phone;
        checkProvider.firm = providerDto.firm ?? checkProvider.firm;
        checkProvider.region = { id: providerDto.regionId ?? checkProvider.region?.id } as Regions;
        checkProvider.recordStatus = providerDto.recordStatus ?? checkProvider.recordStatus;
        var updateProvider = await this.providerService.update(checkProvider);

        return updateProvider;
    }
    @Delete("delete-provider/:id")
    @ApiTags('Providers')
    @ApiOperation({ summary: 'remove provider' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfully.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteProvider(@Param('id') id: number): Promise<boolean> {
        var checkProvider = await this.providerService.getById(id);
        if (!checkProvider) {
            throw new HttpException("The provider is not found!", HttpStatus.NOT_FOUND);
        }
        await this.providerService.delete(checkProvider.id);
        return true;
    }
    //#endregion 


    //#region System Notification

    @Get("get-system-notification/:role")
    @ApiTags('notifications')
    @ApiOperation({ summary: 'Get system notifications by role' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return system notifications.', type: [SystemNotifications] })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getSystemNotifications(@Param('role') role: string): Promise<any[]> {
        var spec = new SystemNotificationByRoleSpecification(role, recordStatus.Active);
        var operations = await this.systemNotificationsService.getWithSpecification(spec, null, null, null);

        return operations.map(notification => {
            return {
                id: notification.idValue,
                createdAt: notification.createAt,
                type: notification.type,
                warehouseId: notification.warehouseId,
                storeId: notification.storeId,
                projectId: notification.projectId
            };
        })
    }

    @Put("set-system-notification-read/:id/:type/:role")
    @ApiTags('notifications')
    @ApiOperation({ summary: 'update system notification' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return updated system notification.', type: SystemNotifications })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateSystemNotification(@Param('id') id: string, @Param('type') type: string, @Param('role') role: string): Promise<SystemNotifications> {

        var spec = new SystemNotificationByForUpdateSpecification(role, recordStatus.Active, type, id);
        var checkNotification = await this.systemNotificationsService.getWithSpecification(spec, null, null, null);

        if (!checkNotification || !checkNotification[0]) {
            throw new HttpException("The system notification is not found!", HttpStatus.NOT_FOUND);
        }

        checkNotification[0].recordStatus = recordStatus.Inactive;
        var updateNotification = await this.systemNotificationsService.update(checkNotification[0]);

        return updateNotification;
    }

    @Put("set-system-notification-read/:type/:role")
    @ApiTags('notifications')
    @ApiOperation({ summary: 'update system notification' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return updated system notification.', type: SystemNotifications })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateAllSystemNotification(@Param('type') type: string, @Param('role') role: string): Promise<SystemNotifications[]> {

        var spec = new SystemNotificationByForAllUpdateSpecification(role, recordStatus.Active, type);
        var checkNotification = await this.systemNotificationsService.getWithSpecification(spec, null, null, null);

        if (!checkNotification || !checkNotification[0]) {
            throw new HttpException("The system notification is not found!", HttpStatus.NOT_FOUND);
        }
        checkNotification.forEach(notification => {
            notification.recordStatus = recordStatus.Inactive;
        });
        var updateNotification = await this.systemNotificationsService.updateMany(checkNotification);
        return updateNotification;
    }

    @Get('to-base64')
    @ApiTags('get-base64')
    @ApiOperation({ summary: 'Convert image URL to Base64' })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async convertImageToBase64(@Query('url') url: string) {
        if (!url) {
            return { error: 'url is required' };
        }

        const response = await axios.get(url, {
            responseType: 'arraybuffer', // مهم
        });

        const base64 = Buffer.from(response.data, 'binary').toString('base64');

        // پیدا کردن نوع عکس (jpg, png, ...)
        const contentType = response.headers['content-type'] || 'image/jpeg';

        return {
            base64: `data:${contentType};base64,${base64}`,
        };
    }
    //#endregion 

}


