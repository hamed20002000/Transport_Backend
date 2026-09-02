import { Controller, Get, Post, Body, Param, Query, UseGuards, HttpException, HttpStatus, Request, Put, BadRequestException, Req, UploadedFile, UseInterceptors, Delete } from '@nestjs/common';
import { UserService } from '../../../application/services/user/user.service';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GenericMapper } from '../../helpers/mapper-classes';
import { UsernameSpecification } from 'src/application/specifications/user/user-specifications';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AdminAndClientRolesGuard, AdminRolesGuard } from 'src/auth/guards/roles.guard';
import { FindOptionsRelations, In } from 'typeorm';
import { Items } from 'src/domain/entities/Items';
import { CreateTenderDto, TenderListDto, UpdateTenderDto, UpdateTenderHeaderDto, UpdateTenderstatusDto } from 'src/presentation/dtos/initial-operations/tender-dto';
import { TenderService } from 'src/application/services/admin/tender.service';
import { TenderHeaders } from 'src/domain/entities/TenderHeaders';
import { TenderDetails } from 'src/domain/entities/TenderDetails';
import { TenderCategories } from 'src/domain/entities/TenderCategories';
import { tenderStatus } from 'src/domain/enums/tenderstatus.enum';
import { Works } from 'src/domain/entities/Works';
import { WorkService } from 'src/application/services/admin/work.service';
import { CreateWorkDto, UpdateWorkDto } from 'src/presentation/dtos/initial-operations/work-dto';
import { ProductTypes } from 'src/domain/entities/ProductTypes';
import { ProductTypeService } from 'src/application/services/admin/product-type.service';
import { CreateProductTypeDto, UpdateProductTypeDto } from 'src/presentation/dtos/initial-operations/product-type-dto';
import { Networks } from 'src/domain/entities/Networks';
import { NetworkService } from 'src/application/services/admin/network.service';
import { CreateNetworkDto, CreateNetworkTransmissionRowDto, CreateNetworkTransmissionSummaryDto, UpdateNetworkDto } from 'src/presentation/dtos/initial-operations/network-dto';
import { TransmissionRowService } from 'src/application/services/admin/transmission-row.service';
import { TransmissionRowSpecification } from 'src/application/specifications/admin/transmission-row-specifications';
import { TransmissionSummary } from 'src/domain/entities/TransmissionSummary';
import { TransmissionSummaryService } from 'src/application/services/admin/transmission-summary.service';
import { Workhouses } from 'src/domain/entities/Workhouses';
import { CreateWorkhouseDetailDto, CreateWorkhouseDto, UpdateWorkhouseDetailDto, UpdateWorkhouseDto } from 'src/presentation/dtos/initial-operations/workhouse-dto';
import { Regions } from 'src/domain/entities/Regions';
import { WorkhouseService } from 'src/application/services/admin/workhouse.service';
import { WorkhouseSpecification } from 'src/application/specifications/admin/workhouse-specifications';
import { WorkhouseDetails } from 'src/domain/entities/WorkhouseDetails';
import { WorkhouseDetailService } from 'src/application/services/admin/workhouse-detail.service';
import { WorkhouseDetailByWorkhouseSpecification, WorkhouseDetailSpecification } from 'src/application/specifications/admin/workhouse-detail-specifications';
import { Warehouses } from 'src/domain/entities/Warehouses';
import { WarehouseService } from 'src/application/services/admin/warehouse.service';
import { WarehouseCodeAndNotIdSpecification, WarehouseCodeSpecification, WarehouseSpecification } from 'src/application/specifications/admin/warehouse-specifications';
import { CreateWarehouseDto, UpdateWarehouseDto } from 'src/presentation/dtos/initial-operations/warehouse-dto';
import { OrderHeaders } from 'src/domain/entities/OrderHeaders';
import { OrderService } from 'src/application/services/admin/order.service';
import { CreateOrderDto, UpdateOrderDto, UpdateOrderstatusDto } from 'src/presentation/dtos/initial-operations/order-dto';
import { OrderHeaderStatusHistories } from 'src/domain/entities/OrderHeaderStatusHistories';
import { OrderHeaderStatusHistoriesService } from 'src/application/services/admin/orderHeaderStatusHistories.service';
import { OrderHeaderStatusHistoriesSpecification } from 'src/application/specifications/admin/orderheaderSatusHistory-specifications';
import { InvoiceService } from 'src/application/services/sale/invoice.service';
import { InvoiceHeaders } from 'src/domain/entities/InvoiceHeaders';
import { CreateInvoiceDto, CreateInvoiceForWorkhouseDto, UpdateInvoiceDto, UpdateInvoiceStatusDto, UpdateInvoiceWorkhouseDto } from 'src/presentation/dtos/sales/invoice.dto';
import { InvoiceHeaderStatusHistoriesSpecification } from 'src/application/specifications/admin/invoiceheaderSatusHistory-specifications';
import { InvoiceHeaderStatusHistoriesService } from 'src/application/services/sale/invoiceHeaderStatusHistories.service';
import { InvoiceHeaderStatusHistories } from 'src/domain/entities/InvoiceHeaderStatusHistories';
import { Stores } from 'src/domain/entities/Stores';
import { StoreService } from 'src/application/services/admin/store.service';
import { StoreByWorkhouseSpecification, StoreCodeAndNotIdSpecification, StoreCodeSpecification, StoreSpecification } from 'src/application/specifications/admin/store-specifications';
import { CreateStoreDto, UpdateStoreDto } from 'src/presentation/dtos/initial-operations/store-dto';
import { UpdateIsEnd } from 'src/presentation/dtos/warehouse/receipt-dto';
import { WorkhouseRents } from 'src/domain/entities/WorkhouseRents';
import { WorkhouseRentsService } from 'src/application/services/warehouse/workhouse-rent.service';
import { WorkhouseRentByWorkhouseSpecification, WorkhouseRentSpecification } from 'src/application/specifications/admin/workhouse-rent-specifications';
import { CreateWorkhouseRentDto, UpdateWorkhouseRentDto, UpdateWorkhouseRentStatusDto } from 'src/presentation/dtos/warehouse/workhouse-rent-dto';
import { workhouseRentStatus } from 'src/domain/enums/workhouseRentStatus.enum';
import { WorkhouseRentStatusHistories } from 'src/domain/entities/WorkkhouseRentStatusHistories';
import { CarWarehouses } from 'src/domain/entities/CarWarehouses';
import { CarWarehouseService } from 'src/application/services/admin/carWarhouse.service';
import { CarWarehouseCodeAndNotIdSpecification, CarWarehouseCodeSpecification, CarWarehouseSpecification } from 'src/application/specifications/admin/car-warehouse-specifications';
import { CreateCarWarehousesDto, UpdateCarWarehousesDto } from 'src/presentation/dtos/carWarehouse/carWarhouses-dto';
import { PersonnelWorkPlacesService } from 'src/application/services/hr/personnelWorkPlaces.service';
import { PersonnelWorkPlacesBytypeAndPlaceIdSpecification, PersonnelWorkPlacesBytypeAndUserRoleIdSpecification } from 'src/application/specifications/hr/personnelWorkPlaces-specifications';
import { WorkPlaceType } from 'src/domain/enums/workPlaceType.enum';
import {  UserRoleSpecification } from 'src/application/specifications/user/user-role-specifications';
import { UserRoleService } from 'src/application/services/user/userRole.service';
import { NotificationsGateway } from 'src/application/services/notificatin/notifications.gateway';


@Controller('api/initial-operations')
export class InitialOperationsController {
    constructor(
        private readonly tenderService: TenderService,
        private readonly userService: UserService,
        private readonly transmissionSummaryService: TransmissionSummaryService,
        private readonly workService: WorkService,
        private readonly productTypeService: ProductTypeService,
        private readonly networkService: NetworkService,
        private readonly transmissionRowService: TransmissionRowService,
        private readonly workhouseService: WorkhouseService,
        private readonly workhouseDetailService: WorkhouseDetailService,
        private readonly warehouseService: WarehouseService,
        private readonly orderService: OrderService,
        private readonly orderHeaderStatusHistoriesService: OrderHeaderStatusHistoriesService,
        private readonly invoiceService: InvoiceService,
        private readonly invoiceHeaderStatusHistoriesService: InvoiceHeaderStatusHistoriesService,
        private readonly storeService: StoreService,
        private readonly workhouseRentsService: WorkhouseRentsService,
        private readonly carWarehouseService: CarWarehouseService,
        private readonly personnelWorkPlacesService: PersonnelWorkPlacesService,
        private readonly userRoleService: UserRoleService,
        private readonly gateway: NotificationsGateway,

    ) { }


    //#region Tender
    @Get("get-tenders")
    @ApiTags('Tenders')
    @ApiOperation({ summary: 'Tenders list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return tenders list.', type: TenderHeaders })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getTenders(): Promise<TenderHeaders[]> {

        var operations = await this.tenderService.getAllTenders();

        return operations;
    }
    @Get("get-tender-by-id/:id")
    @ApiTags('Tenders')
    @ApiOperation({ summary: 'Tender' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return tender.', type: TenderHeaders })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getTenderById(@Param('id') id: number): Promise<TenderHeaders> {

        var operations = await this.tenderService.getTenderById(id);

        return operations;
    }
    @Post("create-tender")
    @ApiTags('Tenders')
    @ApiOperation({ summary: 'new tender' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return tender.', type: TenderListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewTender(@Body() tenderDto: CreateTenderDto, @Request() req): Promise<TenderListDto> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const tender = new TenderHeaders();
        tender.title = tenderDto.title.trim();
        tender.status = tenderStatus.Pending;
        tender.attachments = tenderDto.attachments ? tenderDto.attachments.map(att => ({ fileUrl: att.fileUrl })) : null;
        tender.createAt = new Date();

        tender.recordStatus = recordStatus.Active;
        tender.user = checkUser;

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
        // تبدیل به DTO
        const result = GenericMapper.toDto(TenderListDto, createdTender, {
            excludeExtraneousValues: true,
        });

        return result;
    }

    @Put("update-tender-header")
    @ApiTags('Tenders')
    @ApiOperation({ summary: 'update tender' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return tender .', type: TenderListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateTenderHeader(@Body() tenderDto: UpdateTenderHeaderDto, @Request() req): Promise<TenderListDto> {

        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const checkUser = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const createdTender = await this.tenderService.updateTenderHeader(tenderDto);
        var result = await this.tenderService.getTenderById(tenderDto.id);
        return result;
    }

    @Put("update-tender")
    @ApiTags('Tenders')
    @ApiOperation({ summary: 'update tender' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return tender .', type: TenderListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateTender(@Body() tenderDto: UpdateTenderDto, @Request() req): Promise<TenderListDto> {

        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const checkUser = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const createdTender = await this.tenderService.updateTender(tenderDto);
        var result = await this.tenderService.getTenderById(tenderDto.id);
        return result;
    }
    @Put("update-tender-status")
    @ApiTags('Tenders')
    @ApiOperation({ summary: 'update tender status' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return tender .', type: TenderListDto })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateTenderstatus(@Body() tenderDto: UpdateTenderstatusDto, @Request() req): Promise<TenderListDto> {

        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);
        const checkUser = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );
        var tender = await this.tenderService.getById(tenderDto.id);
        tender.status = tenderDto.status;
        tender.statusDate = new Date();

        const createdTender = await this.tenderService.update(tender);
        var result = await this.tenderService.getTenderById(tenderDto.id);
        return result;
    }
    @Delete("delete-tender/:id")
    @ApiTags('Tenders')
    @ApiOperation({ summary: 'remove Tender' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfull.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteTender(@Param('id') id: number): Promise<boolean> {


        var checkTender = await this.tenderService.getById(id);
        if (!checkTender) {
            throw new HttpException("The tender is not found!", HttpStatus.NOT_FOUND);
        }

        await this.tenderService.delete(checkTender.id);
        return true;
    }
    //#endregion 

    //#region Work
    @Get("get-works")
    @ApiTags('Works')
    @ApiOperation({ summary: 'Work list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return work list.', type: Works })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getWorks(): Promise<Works[]> {

        var operations = await this.workService.getAllWorks();

        return operations;
    }
    @Get("get-work-by-id/:id")
    @ApiTags('Works')
    @ApiOperation({ summary: 'Work' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return work.', type: Works })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getWorkById(@Param('id') id: number): Promise<Works> {

        var operations = await this.workService.getWorkById(id);

        return operations;
    }
    @Post("create-work")
    @ApiTags('Works')
    @ApiOperation({ summary: 'new work' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return work.', type: Works })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewWork(@Body() workDto: CreateWorkDto, @Request() req): Promise<Works> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );
        var tender = await this.tenderService.getById(workDto.tenderId);
        const work = new Works();
        work.title = workDto.title.trim();
        work.startDate = workDto.startDate;
        work.endDate = workDto.endDate;
        work.tender = tender;
        work.createAt = new Date();
        work.recordStatus = recordStatus.Active;
        work.user = checkUser;

        const createdWork = await this.workService.add(work);
        return createdWork;
    }

    @Put("update-work")
    @ApiTags('Works')
    @ApiOperation({ summary: 'update work' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return work .', type: Works })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateWork(@Body() workDto: UpdateWorkDto, @Request() req): Promise<Works> {

        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const checkUser = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        var work = await this.workService.getWorkById(workDto.id);
        if (!work) {
            throw new HttpException("The work is not found!", HttpStatus.NOT_FOUND);
        }

        work.title = workDto.title ?? work.title;
        work.startDate = workDto.startDate ?? work.startDate;
        work.endDate = workDto.endDate ?? work.endDate;
        work.tender.id = workDto.tenderId ?? work.tender.id;
        work.recordStatus = workDto.recordStatus ?? work.recordStatus;

        const createdWork = await this.workService.update(work);

        var result = await this.workService.getWorkById(workDto.id);
        return result;
    }

    @Delete("delete-work/:id")
    @ApiTags('Works')
    @ApiOperation({ summary: 'remove work' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfull.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteWork(@Param('id') id: number): Promise<boolean> {


        var checkWork = await this.workService.getWorkById(id);
        if (!checkWork) {
            throw new HttpException("The work is not found!", HttpStatus.NOT_FOUND);
        }

        await this.workService.delete(checkWork.id);
        return true;
    }
    //#endregion 

    //#region Product Types
    @Get("get-product-types")
    @ApiTags('Product Types')
    @ApiOperation({ summary: 'Product Types list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return product types list.', type: ProductTypes })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getProductTypes(): Promise<ProductTypes[]> {

        var operations = await this.productTypeService.getAllRecords();

        return operations;
    }
    @Get("get-product-type-by-id/:id")
    @ApiTags('Product Types')
    @ApiOperation({ summary: 'Product Type' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return product type.', type: ProductTypes })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getProductTypeById(@Param('id') id: number): Promise<ProductTypes> {

        var operations = await this.productTypeService.getById(id);

        return operations;
    }
    @Post("create-product-type")
    @ApiTags('Product Types')
    @ApiOperation({ summary: 'new product type' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return product type.', type: ProductTypes })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewProductType(@Body() productTypeDto: CreateProductTypeDto, @Request() req): Promise<ProductTypes> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const productType = new ProductTypes();
        productType.name = productTypeDto.name.trim();
        productType.type = productTypeDto.type;
        productType.createAt = new Date();
        productType.recordStatus = recordStatus.Active;
        productType.user = checkUser;

        const createdProductType = await this.productTypeService.add(productType);
        return createdProductType;
    }

    @Put("update-product-type")
    @ApiTags('Product Types')
    @ApiOperation({ summary: 'update product type' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return product type.', type: ProductTypes })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateProductType(@Body() productTypeDto: UpdateProductTypeDto, @Request() req): Promise<ProductTypes> {

        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const checkUser = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        var productType = await this.productTypeService.getById(productTypeDto.id);
        if (!productType) {
            throw new HttpException("The ProductType is not found!", HttpStatus.NOT_FOUND);
        }

        productType.name = productTypeDto.name ?? productType.name;
        productType.type = productTypeDto.type ?? productType.type;
        productType.recordStatus = productTypeDto.recordStatus ?? productType.recordStatus;

        const updatedProductType = await this.productTypeService.update(productType);
        return updatedProductType;
    }

    @Delete("delete-product-type/:id")
    @ApiTags('Product Types')
    @ApiOperation({ summary: 'remove product type' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfully.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteProductType(@Param('id') id: number): Promise<boolean> {


        var checkProductType = await this.productTypeService.getById(id);
        if (!checkProductType) {
            throw new HttpException("The product type is not found!", HttpStatus.NOT_FOUND);
        }

        await this.productTypeService.delete(checkProductType.id);
        return true;
    }
    //#endregion 


    //#region Network
    @Get("get-networks")
    @ApiTags('Networks')
    @ApiOperation({ summary: 'Networks list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return networks list.', type: Networks })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getNetworks(): Promise<Networks[]> {

        var operations = await this.networkService.getAllNetworks();

        return operations;
    }
    @Get("get-network-by-id/:id")
    @ApiTags('Networks')
    @ApiOperation({ summary: 'Network' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return network.', type: Networks })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getNetworkById(@Param('id') id: number): Promise<Networks> {

        var operations = await this.networkService.getNetworkById(id);

        return operations;
    }
    @Get("get-network-by-work-id/:id")
    @ApiTags('Networks')
    @ApiOperation({ summary: 'Network' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return network.', type: Networks })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getNetworkByWorkId(@Param('id') id: number): Promise<Networks> {

        var operations = await this.networkService.getNetworkByWorkId(id);

        return operations;
    }
    @Post("create-network")
    @ApiTags('Networks')
    @ApiOperation({ summary: 'new network' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return network.', type: Networks })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewNetwork(@Body() networkDto: CreateNetworkDto, @Request() req): Promise<Networks> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const network = new Networks();
        network.title = networkDto.title.trim();
        network.description = networkDto.description.trim();
        network.work = { id: networkDto.workId } as Works;
        network.createAt = new Date();
        network.recordStatus = recordStatus.Active;
        network.user = checkUser;



        const createdNetwork = await this.networkService.add(network);



        return createdNetwork;
    }

    @Put("update-network")
    @ApiTags('Networks')
    @ApiOperation({ summary: 'update network' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return network .', type: Networks })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateNetwork(@Body() networkDto: UpdateNetworkDto, @Request() req): Promise<Networks> {

        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const checkUser = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const createdNetwork = await this.networkService.updateNetwork(networkDto);
        var result = await this.networkService.getNetworkById(networkDto.id);
        return result;
    }

    @Delete("delete-network/:id")
    @ApiTags('Networks')
    @ApiOperation({ summary: 'remove Network' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfull.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteNetwork(@Param('id') id: number): Promise<boolean> {


        var checkNetwork = await this.networkService.getById(id);
        if (!checkNetwork) {
            throw new HttpException("The network is not found!", HttpStatus.NOT_FOUND);
        }

        await this.networkService.deleteNetwork(checkNetwork.id);
        return true;
    }
    //#endregion 
    //#region Transmission Row
    @Get("get-transmission-row-by-network-id/:id")
    @ApiTags('Networks')
    @ApiOperation({ summary: 'Transmission Row' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return transmission row.', type: Networks })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getTransmissionRowByNetworkId(@Param('id') id: number): Promise<Networks> {

        var operations = await this.networkService.getTransmissionRowByNetworkId(id);

        return operations;
    }
    @Post("create-TransmissionRow")
    @ApiTags('Networks')
    @ApiOperation({ summary: 'new transmission row' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return transmission row.', type: Networks })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewTransmissionRow(@Body() transmissionRowDto: CreateNetworkTransmissionRowDto, @Request() req): Promise<Networks> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );
        const createdItem = await this.transmissionRowService.createTransmissionRow(transmissionRowDto.createTransmissionRows, transmissionRowDto.networkId, checkUser.id);
        var operations = await this.networkService.getNetworkById(transmissionRowDto.networkId);
        return operations;
    }

    @Put("update-TransmissionRow")
    @ApiTags('Networks')
    @ApiOperation({ summary: 'update transmission row' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return transmission row.', type: Networks })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateTransmissionRow(@Body() transmissionRowDto: CreateNetworkTransmissionRowDto, @Request() req): Promise<Networks> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );
        const updatedItem = await this.transmissionRowService.updateTransmissionRow(transmissionRowDto.createTransmissionRows, transmissionRowDto.networkId, checkUser.id);
        var operations = await this.networkService.getNetworkById(transmissionRowDto.networkId);
        return operations;
    }
    @Delete("delete-TransmissionRow/:networkId")
    @ApiTags('Networks')
    @ApiOperation({ summary: 'remove Transmission Row' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfully.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteTransmissionRow(@Param('networkId') networkId: number): Promise<boolean> {

        var specification = new TransmissionRowSpecification(networkId);
        var checkTransmissionRow = await this.transmissionRowService.getWithSpecification(specification);
        if (!checkTransmissionRow || checkTransmissionRow.length === 0) {
            throw new HttpException("The transmission row is not found!", HttpStatus.NOT_FOUND);
        }

        await this.transmissionRowService.removeTransmissionRow(networkId);
        return true;
    }




    //#endregion

    //#region TransmissionSummary
    @Post("create-transmissionSummary")
    @ApiTags('Networks')
    @ApiOperation({ summary: 'new transmission summary' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return transmission summary.', type: Networks })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewTransmissionSummary(@Body() transmissionSummaryDto: CreateNetworkTransmissionSummaryDto, @Request() req): Promise<Networks> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );
        const transmissionSummaries = transmissionSummaryDto.transmissionSummaries.map((summaryDto) => {
            const transmissionSummary = new TransmissionSummary();
            transmissionSummary.weight = summaryDto.weight;
            transmissionSummary.length = summaryDto.length;
            transmissionSummary.item = { id: summaryDto.itemId } as Items;
            transmissionSummary.productStatus = summaryDto.productStatus;
            transmissionSummary.dMMPercent = summaryDto.dMMPercent;
            transmissionSummary.totalWeight = summaryDto.totalWeight;
            transmissionSummary.network = { id: transmissionSummaryDto.networkId } as Networks;
            transmissionSummary.createAt = new Date();
            transmissionSummary.recordStatus = recordStatus.Active;
            transmissionSummary.user = checkUser;
            return transmissionSummary;
        });
        await this.transmissionSummaryService.addMany(transmissionSummaries);
        var operations = await this.networkService.getNetworkById(transmissionSummaryDto.networkId);
        return operations;
    }

    @Put("update-transmissionSummary")
    @ApiTags('Networks')
    @ApiOperation({ summary: 'update transmission summary' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return updated transmission summary.', type: Networks })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateNewTransmissionSummary(@Body() transmissionSummaryDto: CreateNetworkTransmissionSummaryDto, @Request() req): Promise<Networks> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );
        await this.transmissionSummaryService.updateTransmissionSummaries(transmissionSummaryDto, checkUser);

        var operations = await this.networkService.getNetworkById(transmissionSummaryDto.networkId);
        return operations;
    }
    @Delete("delete-transmissionSummary/:networkId")
    @ApiTags('Networks')
    @ApiOperation({ summary: 'remove Transmission Summary' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfully.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteTransmissionSummary(@Param('networkId') networkId: number): Promise<boolean> {
        return await this.transmissionSummaryService.deleteTransmissionSummaries(networkId);
    }


    //#endregion

    //#region Workhouse

    @Get("get-workhouse")
    @ApiTags('Workhouses')
    @ApiOperation({ summary: 'Workhouses list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return workhouses list.', type: Workhouses })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getWorkhouses(@Req() req: any,@Query('rolename') rolename?: string): Promise<Workhouses[]> {


        const relations: FindOptionsRelations<Workhouses> = {
            region: true,
            work: true

        };
        if (rolename) {
            var spec = new UserRoleSpecification(rolename, req.user.userid);
            var userRoleId = await this.userRoleService.getWithSpecification(spec, null, { id: true }, null);
            var workPlaces = await this.personnelWorkPlacesService.getWithSpecification(new PersonnelWorkPlacesBytypeAndUserRoleIdSpecification(userRoleId[0].id, WorkPlaceType.Workhouse), null, { placeId: true }, null);
            var operations = await this.workhouseService.getWithSpecification(null, null, null, relations);
            operations = operations.filter(w => workPlaces.findIndex(wp => wp.placeId === w.id) > -1);

            return operations;
        } else {
            var operations = await this.workhouseService.getWithSpecification(null, null, null, relations);
            return operations;
        }


    }
    @Get("get-workhouse-by-id/:id")
    @ApiTags('Workhouses')
    @ApiOperation({ summary: 'Workhouses' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return workhouse.', type: Workhouses })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getWorkhouseById(@Param('id') id: number): Promise<Workhouses> {
        var spec = new WorkhouseSpecification(id);
        const relations: FindOptionsRelations<Workhouses> = {
            region: true,
            work: true
        };
        var operations = await this.workhouseService.getWithSpecification(spec, null, null, relations);

        return operations[0];
    }
    @Post("create-workhouse")
    @ApiTags('Workhouses')
    @ApiOperation({ summary: 'create new workhouse' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return created workhouse.', type: Workhouses })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewWorkhouse(@Body() workhouseDto: CreateWorkhouseDto, @Request() req): Promise<Workhouses> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const workhouse = new Workhouses();
        workhouse.name = workhouseDto.name;
        workhouse.code = workhouseDto.code;
        workhouse.address = workhouseDto.address;
        workhouse.region = { id: workhouseDto.regionId } as Regions;
        workhouse.work = { id: workhouseDto.workId } as Works;
        workhouse.createAt = new Date();
        workhouse.recordStatus = recordStatus.Active;
        workhouse.user = checkUser;

        await this.workhouseService.add(workhouse);
        return workhouse;
    }

    @Put("update-workhouse")
    @ApiTags('Workhouses')
    @ApiOperation({ summary: 'update workhouse' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return updated workhouse.', type: Workhouses })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateWorkhouse(@Body() workhouseDto: UpdateWorkhouseDto, @Request() req): Promise<Workhouses> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );
        var workhouse = await this.workhouseService.getById(workhouseDto.id);
        if (!workhouse) {
            throw new HttpException("The workhouse is not found!", HttpStatus.NOT_FOUND);
        }

        workhouse.name = workhouseDto.name ?? workhouse.name;
        workhouse.code = workhouseDto.code ?? workhouse.code;
        workhouse.address = workhouseDto.address ?? workhouse.address;
        workhouse.endDate = workhouseDto.endDate ?? workhouse.endDate;

        var spec = new PersonnelWorkPlacesBytypeAndPlaceIdSpecification(workhouseDto.id, WorkPlaceType.Workhouse);
        var PersonnelWorkPlaces = await this.personnelWorkPlacesService.getWithSpecification(spec);

        if (PersonnelWorkPlaces && PersonnelWorkPlaces.length > 0) {
            PersonnelWorkPlaces.forEach(async pwp => {
                pwp.endDate = workhouseDto.endDate ?? workhouse.endDate;
                await this.personnelWorkPlacesService.update(pwp);
            });
        }
        if (workhouseDto.regionId) {
            workhouse.region = { id: workhouseDto.regionId ?? workhouse.region.id } as Regions;
        }
        if (workhouseDto.workId) {
            workhouse.work = { id: workhouseDto.workId ?? workhouse.work.id } as Works;
        }

        await this.workhouseService.update(workhouse);
        return await this.workhouseService.getById(workhouseDto.id);
    }
    @Delete("delete-workhouse/:workhouseId")
    @ApiTags('Workhouses')
    @ApiOperation({ summary: 'remove workhouse' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfully.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteWorkhouse(@Param('workhouseId') workhouseId: number): Promise<boolean> {
        await this.workhouseService.delete(workhouseId);
        return true;
    }


    //#endregion

    //#region Workhouse details

    @Get("get-workhouse-details-by-workhouse-id/:workhouseId")
    @ApiTags('WorkhouseDetails')
    @ApiOperation({ summary: 'Workhouse detail list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return workhouse detail list.', type: WorkhouseDetails })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getWorkhouseDetails(@Param('workhouseId') workhouseId: number): Promise<WorkhouseDetails[]> {
        const relations: FindOptionsRelations<WorkhouseDetails> = {
            workhouse: true
        };
        var spec = new WorkhouseDetailByWorkhouseSpecification(workhouseId);
        var operations = await this.workhouseDetailService.getWithSpecification(spec, null, null, relations);

        return operations;
    }
    @Get("get-workhouseDetail-by-id/:id")
    @ApiTags('WorkhouseDetails')
    @ApiOperation({ summary: 'Workhouse detail' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return workhouse detail.', type: WorkhouseDetails })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getWorkhouseDetailById(@Param('id') id: number): Promise<WorkhouseDetails> {
        var spec = new WorkhouseDetailSpecification(id);
        const relations: FindOptionsRelations<WorkhouseDetails> = {
            workhouse: true

        };
        var operations = await this.workhouseDetailService.getWithSpecification(spec, null, null, relations);

        return operations[0];
    }
    @Post("create-workhouse-detail")
    @ApiTags('WorkhouseDetails')
    @ApiOperation({ summary: 'create new workhouse detail' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return created workhouse detail.', type: WorkhouseDetails })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewWorkhouseDetail(@Body() workhouseDto: CreateWorkhouseDetailDto, @Request() req): Promise<WorkhouseDetails> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const workhouseDetail = new WorkhouseDetails();
        workhouseDetail.owner = workhouseDto.owner;
        workhouseDetail.rentStartDate = workhouseDto.rentStartDate;
        workhouseDetail.rentEndDate = workhouseDto.rentEndDate;
        workhouseDetail.price = workhouseDto.price;
        workhouseDetail.subscription = workhouseDto.subscriptions ? workhouseDto.subscriptions.map(att => ({ no: att.no, owner: att.owner, title: att.title })) : null;
        workhouseDetail.description = workhouseDto.description;
        workhouseDetail.attachments = workhouseDto.attachments ? workhouseDto.attachments.map(att => ({ fileUrl: att.fileUrl })) : null;
        workhouseDetail.workhouse = { id: workhouseDto.workhouseId } as Workhouses;
        workhouseDetail.createAt = new Date();
        workhouseDetail.recordStatus = recordStatus.Active;
        workhouseDetail.user = checkUser;

        await this.workhouseDetailService.add(workhouseDetail);
        return workhouseDetail;
    }

    @Put("update-workhouseDetail")
    @ApiTags('WorkhouseDetails')
    @ApiOperation({ summary: 'update workhouse detail' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return updated workhouse detail.', type: WorkhouseDetails })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateWorkhouseDetail(@Body() workhouseDto: UpdateWorkhouseDetailDto, @Request() req): Promise<WorkhouseDetails> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );
        var workhouseDetail = await this.workhouseDetailService.getById(workhouseDto.id);
        if (!workhouseDetail) {
            throw new HttpException("The workhouse detail is not found!", HttpStatus.NOT_FOUND);
        }

        workhouseDetail.owner = workhouseDto.owner ?? workhouseDetail.owner;
        workhouseDetail.rentStartDate = workhouseDto.rentStartDate ?? workhouseDetail.rentStartDate;
        workhouseDetail.rentEndDate = workhouseDto.rentEndDate ?? workhouseDetail.rentEndDate;
        workhouseDetail.price = workhouseDto.price ?? workhouseDetail.price;

        if (workhouseDto.attachments) {
            workhouseDetail.attachments = workhouseDto.attachments.map(att => ({ fileUrl: att.fileUrl }));
        }
        if (workhouseDto.subscriptions) {
            workhouseDetail.subscription = workhouseDto.subscriptions.map(att => ({ no: att.no, owner: att.owner, title: att.title }));
        }
        workhouseDetail.description = workhouseDto.description;
        if (workhouseDto.workhouseId != undefined && workhouseDto.workhouseId != null) {
            workhouseDetail.workhouse = { id: workhouseDto.workhouseId ?? workhouseDetail.workhouse.id } as Workhouses;

        }
        await this.workhouseDetailService.update(workhouseDetail);
        return await this.workhouseDetailService.getById(workhouseDto.id);
    }
    @Delete("delete-workhouse-detail/:workhouseDetailId")
    @ApiTags('WorkhouseDetails')
    @ApiOperation({ summary: 'remove workhouse detail' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfully.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteWorkhouseDetail(@Param('workhouseDetailId') workhouseDetailId: number): Promise<boolean> {
        await this.workhouseDetailService.delete(workhouseDetailId);
        return true;
    }


    //#endregion


    //#region Workhouse rents

    @Get("get-workhouse-rent-by-workhouse-id/:workhouseId")
    @ApiTags('WorkhouseRents')
    @ApiOperation({ summary: 'Workhouse rent list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return workhouse rent list.', type: WorkhouseRents })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getWorkhouseRents(@Param('workhouseId') workhouseId: number,@Req() req: any, @Query('rolename') rolename?: string): Promise<WorkhouseRents[]> {
        const relations: FindOptionsRelations<WorkhouseRents> = {
            workhouse: true
        };
        var specWorkRent = new WorkhouseRentByWorkhouseSpecification(workhouseId);
        // var operations = await this.workhouseRentsService.getWithSpecification(specWorkRent, null, null, relations);
        if (rolename) {
            var spec = new UserRoleSpecification(rolename, req.user.userid);
            var userRoleId = await this.userRoleService.getWithSpecification(spec, null, { id: true }, null);
            var workPlaces = await this.personnelWorkPlacesService.getWithSpecification(new PersonnelWorkPlacesBytypeAndUserRoleIdSpecification(userRoleId[0].id, WorkPlaceType.Workhouse), null, { placeId: true }, null);
            var operations = await this.workhouseRentsService.getWithSpecification(specWorkRent, null, null, relations);
            operations = operations.filter(w => workPlaces.findIndex(wp => wp.placeId === w.workhouse.id) > -1);
            return operations;
        } else {
            var operations = await this.workhouseRentsService.getWithSpecification(specWorkRent, null, null, relations);
            return operations;
        }

        //return operations;
    }
    @Get("get-workhouseRent-by-id/:id")
    @ApiTags('WorkhouseRents')
    @ApiOperation({ summary: 'Workhouse rent' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return workhouse rent.', type: WorkhouseRents })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getWorkhouseRentById(@Param('id') id: number): Promise<WorkhouseRents> {
        var spec = new WorkhouseRentSpecification(id);
        const relations: FindOptionsRelations<WorkhouseRents> = {
            workhouse: true,
            workhouseRentStatusHistories: { user: true }

        };
        var operations = await this.workhouseRentsService.getWithSpecification(spec, null, null, relations);

        return operations[0];
    }
    @Post("create-workhouse-rent")
    @ApiTags('WorkhouseRents')
    @ApiOperation({ summary: 'create new workhouse rent' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return created workhouse rent.', type: WorkhouseRents })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewWorkhouseRent(@Body() workhouseDto: CreateWorkhouseRentDto, @Request() req): Promise<WorkhouseRents> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const workhouseRent = new WorkhouseRents();
        workhouseRent.title = workhouseDto.title;
        workhouseRent.description = workhouseDto.description;
        workhouseRent.driverInfo = workhouseDto.driverInfo;
        workhouseRent.price = workhouseDto.price;
        workhouseRent.company = workhouseDto.company;
        workhouseRent.rentStartDate = workhouseDto.rentStartDate;
        workhouseRent.rentEndDate = workhouseDto.rentEndDate;
        workhouseRent.status = workhouseRentStatus.Pending;

        // create a proper status history entity with required fields
        const initialStatus = new WorkhouseRentStatusHistories();
        initialStatus.status = workhouseRent.status;
        initialStatus.createAt = new Date();
        initialStatus.user = checkUser;
        initialStatus.description = workhouseDto.description ?? null;
        initialStatus.statusDescription = '';
        initialStatus.recordStatus = recordStatus.Active;


        workhouseRent.workhouseRentStatusHistories = [initialStatus];

        workhouseRent.attachments = workhouseDto.attachments ? workhouseDto.attachments.map(att => ({ fileUrl: att.fileUrl })) : null;
        workhouseRent.workhouse = { id: workhouseDto.workhouseId } as Workhouses;
        workhouseRent.createAt = new Date();
        workhouseRent.recordStatus = recordStatus.Active;
        workhouseRent.user = checkUser;

        await this.workhouseRentsService.add(workhouseRent);
        return workhouseRent;
    }


    @Put("update-workhouseRent")
    @ApiTags('WorkhouseRents')
    @ApiOperation({ summary: 'update workhouse rent' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return updated workhouse rent.', type: WorkhouseRents })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateWorkhouseRent(@Body() workhouseDto: UpdateWorkhouseRentDto, @Request() req): Promise<WorkhouseRents> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        var workhouseRent = await this.workhouseRentsService.getById(workhouseDto.id);
        if (!workhouseRent) {
            throw new HttpException("The workhouse rent is not found!", HttpStatus.NOT_FOUND);
        }

        workhouseRent.title = workhouseDto.title ?? workhouseRent.title;
        workhouseRent.description = workhouseDto.description ?? workhouseRent.description;
        workhouseRent.driverInfo = workhouseDto.driverInfo ?? workhouseRent.driverInfo;
        workhouseRent.price = workhouseDto.price ?? workhouseRent.price;
        workhouseRent.company = workhouseDto.company ?? workhouseRent.company;
        workhouseRent.rentStartDate = workhouseDto.rentStartDate ?? workhouseRent.rentStartDate;
        workhouseRent.rentEndDate = workhouseDto.rentEndDate ?? workhouseRent.rentEndDate;

        if (workhouseDto.attachments) {
            // Replace existing attachments entirely with the provided ones.
            // If an empty array is passed, this will clear all attachments.
            workhouseRent.attachments = workhouseDto.attachments.length > 0
                ? workhouseDto.attachments.map(att => ({ fileUrl: att.fileUrl }))
                : [];
        }
        workhouseRent.recordStatus = workhouseDto.recordStatus ?? workhouseRent.recordStatus;
        if (workhouseDto.workhouseId != undefined && workhouseDto.workhouseId != null) {
            workhouseRent.workhouse = { id: workhouseDto.workhouseId } as Workhouses;
        }

        await this.workhouseRentsService.update(workhouseRent);
        return await this.workhouseRentsService.getById(workhouseDto.id);
    }

    @Put("update-workhouse-rent-status")
    @ApiTags('WorkhouseRents')
    @ApiOperation({ summary: 'update workhouse rent status' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return workhouse rent.', type: WorkhouseRents })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateWorkhouseRentStatus(@Body() workhouseDto: UpdateWorkhouseRentStatusDto, @Request() req): Promise<WorkhouseRents> {

        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);
        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );
        var spec = new WorkhouseRentSpecification(workhouseDto.id);
        var relations: FindOptionsRelations<WorkhouseRents> = {
            workhouse: true,
            workhouseRentStatusHistories: true
        };
        var workhouseRent = await this.workhouseRentsService.getWithSpecification(spec, null, null, relations);
        workhouseRent[0].status = workhouseDto.status;


        workhouseRent[0].workhouseRentStatusHistories.forEach(async history => {
            history.recordStatus = recordStatus.Inactive;

        });

        const statusHistory = new WorkhouseRentStatusHistories();
        statusHistory.status = workhouseDto.status;
        statusHistory.createAt = new Date();
        statusHistory.user = checkUser;
        statusHistory.statusDescription = workhouseDto.statusDescription ?? '';
        statusHistory.recordStatus = recordStatus.Active;
        workhouseRent[0].workhouseRentStatusHistories.push(statusHistory);
        workhouseRent[0].status = workhouseDto.status;
        workhouseRent[0].statusdescription = workhouseDto.statusDescription ?? '';
        var result = await this.workhouseRentsService.update(workhouseRent[0]);

        return result;
    }
    @Delete("delete-workhouse-rent/:workhouseRentId")
    @ApiTags('WorkhouseRents')
    @ApiOperation({ summary: 'remove workhouse rent' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfully.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteWorkhouseRent(@Param('workhouseRentId') workhouseRentId: number): Promise<boolean> {


        await this.workhouseRentsService.deleteWorkhouseRent(workhouseRentId);
        return true;
    }


    //#endregion

    //#region warehouses

    @Get("get-warehouses")
    @ApiTags('Warehouses')
    @ApiOperation({ summary: 'Warehouses list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return warehouses list.', type: Warehouses })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getWarehouses(@Req() req: any,@Query('rolename') rolename?: string): Promise<Warehouses[]> {
        const relations: FindOptionsRelations<Warehouses> = {
            region: true,


        };
        if (rolename) {
            var spec = new UserRoleSpecification(rolename, req.user.userid);
            var userRoleId = await this.userRoleService.getWithSpecification(spec, null, { id: true }, null);
            var workPlaces = await this.personnelWorkPlacesService.getWithSpecification(new PersonnelWorkPlacesBytypeAndUserRoleIdSpecification(userRoleId[0].id, WorkPlaceType.Warehouse), null, { placeId: true }, null);
            var operations = await this.warehouseService.getWithSpecification(null, null, null, relations);
            operations = operations.filter(w => workPlaces.findIndex(wp => wp.placeId === w.id) > -1);
            return operations;
        } else {

            var operations = await this.warehouseService.getWithSpecification(null, null, null, relations);

            return operations;


        }
    }
    @Get("get-warehouse-by-id/:id")
    @ApiTags('Warehouses')
    @ApiOperation({ summary: 'Warehouses' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return warehouse.', type: Warehouses })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getWarehouseById(@Param('id') id: number,@Req() req: any, @Query('rolename') rolename?: string): Promise<Warehouses> {
        var specWarehouse = new WarehouseSpecification(id);
        const relations: FindOptionsRelations<Warehouses> = {
            region: true,
            warehouseTransactions: true,

        };
        if (rolename) {
            var spec = new UserRoleSpecification(rolename, req.user.userid);
            var userRoleId = await this.userRoleService.getWithSpecification(spec, null, { id: true }, null);
            var workPlaces = await this.personnelWorkPlacesService.getWithSpecification(new PersonnelWorkPlacesBytypeAndUserRoleIdSpecification(userRoleId[0].id, WorkPlaceType.Warehouse), null, { placeId: true }, null);
            var operations = await this.warehouseService.getWithSpecification(specWarehouse, null, null, relations);
            operations = operations.filter(w => workPlaces.findIndex(wp => wp.placeId === w.id) > -1);
            return operations[0];
        } else {

            var operations = await this.warehouseService.getWithSpecification(specWarehouse, null, null, relations);

            return operations[0];
        }
    }

    @Post("create-warehouse")
    @ApiTags('Warehouses')
    @ApiOperation({ summary: 'create new warehouse' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return created warehouse.', type: Warehouses })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewWarehouse(@Body() warehouseDto: CreateWarehouseDto, @Request() req): Promise<Warehouses> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );
        var spec = new WarehouseCodeSpecification(warehouseDto.code);
        var chekCode = await this.warehouseService.getWithSpecification(spec);
        if (chekCode && chekCode.length > 0) {
            throw new HttpException("Warehouse with this code already exists!", HttpStatus.BAD_REQUEST);
        }
        const warehouse = new Warehouses();
        warehouse.name = warehouseDto.name;
        warehouse.code = warehouseDto.code;
        warehouse.address = warehouseDto.address;
        warehouse.region = { id: warehouseDto.regionId } as Regions;
        warehouse.createAt = new Date();
        warehouse.recordStatus = recordStatus.Active;
        warehouse.user = checkUser;

        await this.warehouseService.add(warehouse);
        return warehouse;
    }

    @Put("update-warehouse")
    @ApiTags('Warehouses')
    @ApiOperation({ summary: 'update warehouse' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return updated warehouse.', type: Warehouses })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateWarehouse(@Body() warehouseDto: UpdateWarehouseDto, @Request() req): Promise<Warehouses> {
        const user = req.user;
        var warehouse = await this.warehouseService.getById(warehouseDto.id);
        if (!warehouse) {
            throw new HttpException("The warehouse is not found!", HttpStatus.NOT_FOUND);
        }
        if (warehouseDto.code) {
            var spec = new WarehouseCodeAndNotIdSpecification(warehouseDto.code, warehouseDto.id);
            var chekCode = await this.warehouseService.getWithSpecification(spec);
            if (chekCode && chekCode.length > 0) {
                throw new HttpException("Warehouse with this code already exists!", HttpStatus.BAD_REQUEST);
            }
        }

        warehouse.name = warehouseDto.name ?? warehouse.name;
        warehouse.code = warehouseDto.code ?? warehouse.code;
        warehouse.address = warehouseDto.address ?? warehouse.address;
        if (warehouseDto.regionId != undefined && warehouseDto.regionId != null) {
            warehouse.region = { id: warehouseDto.regionId ?? warehouse.region.id } as Regions;
        }
        warehouse.recordStatus = warehouseDto.recordStatus ?? warehouse.recordStatus;
        await this.warehouseService.update(warehouse);
        return await this.warehouseService.getById(warehouseDto.id);
    }
    @Delete("delete-warehouse/:warehouseId")
    @ApiTags('Warehouses')
    @ApiOperation({ summary: 'remove warehouse' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfully.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteWarehouse(@Param('warehouseId') warehouseId: number): Promise<boolean> {
        await this.warehouseService.delete(warehouseId);
        return true;
    }


    //#endregion


    //#region Order
    @Get("get-orders")
    @ApiTags('Orders')
    @ApiOperation({ summary: 'Orders list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return orders list.', type: OrderHeaders })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getOrders(): Promise<OrderHeaders[]> {

        var operations = await this.orderService.getAllOrders();

        return operations;
    }

    @Get("get-orders-by-workhouse-id/:workhouseId")
    @ApiTags('Orders')
    @ApiOperation({ summary: 'Orders list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return orders list.', type: OrderHeaders })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getOrdersByWorkhouseId(@Param('workhouseId') workhouseId: number): Promise<OrderHeaders[]> {


        var operations = await this.orderService.getAllOrderByWorkhouse(workhouseId);

        return operations;
    }
    @Get("get-order-by-id/:id")
    @ApiTags('Orders')
    @ApiOperation({ summary: 'Order' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return order.', type: OrderHeaders })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getOrderById(@Param('id') id: number): Promise<OrderHeaders> {

        var operations = await this.orderService.getOrderById(id);

        return operations;
    }
    @Post("create-order")
    @ApiTags('Orders')
    @ApiOperation({ summary: 'new order' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return order.', type: OrderHeaders })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewOrder(@Body() orderDto: CreateOrderDto, @Request() req): Promise<OrderHeaders> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const createdOrder = await this.orderService.createOrder(orderDto, checkUser.id);
        // تبدیل به DTO
        const result = GenericMapper.toDto(OrderHeaders, createdOrder, {
            excludeExtraneousValues: true,
        });


        return result;
    }

    @Put("update-order")
    @ApiTags('Orders')
    @ApiOperation({ summary: 'update order' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return order .', type: OrderHeaders })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateOrder(@Body() orderDto: UpdateOrderDto, @Request() req): Promise<OrderHeaders> {

        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const updateOrder = await this.orderService.updateOrder(orderDto, checkUser.id);
        var result = await this.orderService.getOrderById(orderDto.id);
        return result;
    }
    @Put("update-order-status")
    @ApiTags('Orders')
    @ApiOperation({ summary: 'update order status' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return order .', type: OrderHeaders })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateOrderStatus(@Body() orderDto: UpdateOrderstatusDto, @Request() req): Promise<OrderHeaders> {

        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);
        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );
        var order = await this.orderService.getById(orderDto.id);
        order.status = orderDto.status;
        var spec = new OrderHeaderStatusHistoriesSpecification(order.id);
        var oldHistory = await this.orderHeaderStatusHistoriesService.getWithSpecification(spec);
        if (oldHistory && oldHistory.length > 0) {
            oldHistory.forEach(async history => {
                history.recordStatus = recordStatus.Inactive;

            });
            await this.orderHeaderStatusHistoriesService.updateMany(oldHistory);
        }

        var orderStatusHistory = new OrderHeaderStatusHistories();
        orderStatusHistory.orderHeader = { id: order.id } as OrderHeaders;
        orderStatusHistory.status = order.status;
        orderStatusHistory.description = orderDto.description;
        orderStatusHistory.createAt = new Date();
        orderStatusHistory.recordStatus = recordStatus.Active;
        orderStatusHistory.user = checkUser;
        const historyCreated = await this.orderHeaderStatusHistoriesService.add(orderStatusHistory);
        const updated = await this.orderService.update(order);
        var result = await this.orderService.getOrderById(orderDto.id);
        return result;
    }

    @Put("update-order-is-end")
    @ApiTags('Orders')
    @ApiOperation({ summary: 'update Order isEnd' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return order .', type: OrderHeaders })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateOrderIsEnd(@Body() dto: UpdateIsEnd, @Request() req): Promise<OrderHeaders> {

        var item = await this.orderService.getById(dto.id);
        item.isEnd = dto.isEnd;
        const updateOrder = await this.orderService.update(item);
        return item;
    }
    @Delete("delete-order/:id")
    @ApiTags('Orders')
    @ApiOperation({ summary: 'remove Order' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfull.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteOrder(@Param('id') id: number): Promise<boolean> {


        var checkOrder = await this.orderService.getById(id);
        if (!checkOrder) {
            throw new HttpException("The order is not found!", HttpStatus.NOT_FOUND);
        }

        await this.orderService.deleteOrder(checkOrder.id);
        return true;
    }
    //#endregion 

    //#region Invoice
    @Get("get-invoices")
    @ApiTags('Invoice')
    @ApiOperation({ summary: 'Invoices list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return invoices list.', type: InvoiceHeaders })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getInvoices(): Promise<InvoiceHeaders[]> {

        var operations = await this.invoiceService.getAllInvoices();

        return operations;
    }

    @Get("get-invoices-by-warehouse-id/:warehouseId")
    @ApiTags('Invoice')
    @ApiOperation({ summary: 'Invoices list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return invoices list.', type: InvoiceHeaders })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getInvoicesByWarehouseId(@Param('warehouseId') warehouseId: number): Promise<InvoiceHeaders[]> {

        var operations = await this.invoiceService.getAllInvoicesByWarehouseId(warehouseId);

        return operations;
    }

    @Get("get-invoices-by-workhouse-id/:workhouseId")
    @ApiTags('Invoice')
    @ApiOperation({ summary: 'Invoices list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return invoices list.', type: InvoiceHeaders })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getInvoicesByWorkhouse(@Param('workhouseId') workhouseId: number): Promise<InvoiceHeaders[]> {

        var operations = await this.invoiceService.getAllInvoicesByWorkhouseId(workhouseId);

        return operations;
    }
    @Get("get-invoice-by-id/:id")
    @ApiTags('Invoice')
    @ApiOperation({ summary: 'Invoice' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return invoice.', type: InvoiceHeaders })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getInvoiceById(@Param('id') id: number): Promise<InvoiceHeaders> {

        var operations = await this.invoiceService.getInvoiceById(id);

        return operations;
    }
    @Post("create-invoice")
    @ApiTags('Invoice')
    @ApiOperation({ summary: 'new invoice' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return invoice.', type: InvoiceHeaders })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewInvoice(@Body() invoiceDto: CreateInvoiceDto, @Request() req): Promise<InvoiceHeaders> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const createdInvoice = await this.invoiceService.createInvoice(invoiceDto, checkUser.id);
        // تبدیل به DTO
        const result = GenericMapper.toDto(InvoiceHeaders, createdInvoice, {
            excludeExtraneousValues: true,
        });

        return result;
    }

    @Post("create-invoice-for-workhouse")
    @ApiTags('Invoice')
    @ApiOperation({ summary: 'new invoice' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return invoice.', type: InvoiceHeaders })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewInvoiceForWorkhouse(@Body() invoiceDto: CreateInvoiceForWorkhouseDto, @Request() req): Promise<InvoiceHeaders> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const createdInvoice = await this.invoiceService.createInvoiceForStore(invoiceDto, checkUser.id);
        // تبدیل به DTO
        const result = GenericMapper.toDto(InvoiceHeaders, createdInvoice, {
            excludeExtraneousValues: true,
        });

        return result;
    }

    @Put("update-invoice")
    @ApiTags('Invoice')
    @ApiOperation({ summary: 'update invoice' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return invoice .', type: InvoiceHeaders })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateInvoice(@Body() invoiceDto: UpdateInvoiceDto, @Request() req): Promise<InvoiceHeaders> {

        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const updateInvoice = await this.invoiceService.updateInvoice(invoiceDto, checkUser.id);
        var result = await this.invoiceService.getInvoiceById(invoiceDto.id);
        return result;
    }

    @Put("update-invoice-for-workhouse")
    @ApiTags('Invoice')
    @ApiOperation({ summary: 'update invoice' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return invoice .', type: InvoiceHeaders })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateInvoiceForWorkhouse(@Body() invoiceDto: UpdateInvoiceWorkhouseDto, @Request() req): Promise<InvoiceHeaders> {

        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );

        const updateInvoice = await this.invoiceService.updateInvoiceForStore(invoiceDto, checkUser.id);
        var result = await this.invoiceService.getInvoiceById(invoiceDto.id);
        return result;
    }
    @Put("update-invoice-status")
    @ApiTags('Invoice')
    @ApiOperation({ summary: 'update invoice status' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return invoice .', type: InvoiceHeaders })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateInvoiceStatus(@Body() invoiceDto: UpdateInvoiceStatusDto, @Request() req): Promise<InvoiceHeaders> {

        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);
        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );
        var invoice = await this.invoiceService.getById(invoiceDto.id);
        invoice.status = invoiceDto.status;
        var spec = new InvoiceHeaderStatusHistoriesSpecification(invoice.id);
        var oldHistory = await this.invoiceHeaderStatusHistoriesService.getWithSpecification(spec);
        if (oldHistory && oldHistory.length > 0) {
            oldHistory.forEach(async history => {
                history.recordStatus = recordStatus.Inactive;

            });
            await this.invoiceHeaderStatusHistoriesService.updateMany(oldHistory);
        }

        var invoiceStatusHistory = new InvoiceHeaderStatusHistories();
        invoiceStatusHistory.invoiceHeader = { id: invoice.id } as InvoiceHeaders;
        invoiceStatusHistory.status = invoice.status;
        invoiceStatusHistory.description = invoiceDto.description;
        invoiceStatusHistory.createAt = new Date();
        invoiceStatusHistory.recordStatus = recordStatus.Active;
        invoiceStatusHistory.user = checkUser;
        const historyCreated = await this.invoiceHeaderStatusHistoriesService.add(invoiceStatusHistory);
        const updated = await this.invoiceService.update(invoice);
        var result = await this.invoiceService.getInvoiceById(invoiceDto.id);
        return result;
    }

    @Put("update-invoice-is-end")
    @ApiTags('Invoice')
    @ApiOperation({ summary: 'update Invoice is end status' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return invoice .', type: InvoiceHeaders })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateInvoiceIsEnd(@Body() dto: UpdateIsEnd, @Request() req): Promise<InvoiceHeaders> {



        var item = await this.invoiceService.getById(dto.id);
        item.isEnd = dto.isEnd;

        const updateInvoice = await this.invoiceService.update(item);

        return item;
    }
    @Delete("delete-invoice/:id")
    @ApiTags('Invoice')
    @ApiOperation({ summary: 'remove Invoice' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfull.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteInvoice(@Param('id') id: number): Promise<boolean> {


        var checkInvoice = await this.invoiceService.getById(id);
        if (!checkInvoice) {
            throw new HttpException("The invoice is not found!", HttpStatus.NOT_FOUND);
        }

        await this.invoiceService.deleteInvoice(checkInvoice.id);
        return true;
    }
    //#endregion 

    //#region Stores

    @Get("get-stores")
    @ApiTags('Stores')
    @ApiOperation({ summary: 'Stores list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return stores list.', type: Stores })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getStores(@Req() req: any, @Query('rolename') rolename?: string): Promise<Stores[]> {
        const relations: FindOptionsRelations<Stores> = {
            region: true,
            workhouse: true
        };

        // var operations = await this.storeService.getWithSpecification(null, null, null, relations);
        if (rolename) {
            var spec = new UserRoleSpecification(rolename,req.user.userid);
            var userRoleId = await this.userRoleService.getWithSpecification(spec, null, { id: true }, null);
            var workPlaces = await this.personnelWorkPlacesService.getWithSpecification(new PersonnelWorkPlacesBytypeAndUserRoleIdSpecification(userRoleId[0].id, WorkPlaceType.Store), null, { placeId: true }, null);
            var operations = await this.storeService.getWithSpecification(null, null, null, relations);
            operations = operations.filter(w => workPlaces.findIndex(wp => wp.placeId === w.id) > -1);
            return operations;
        } else {
            var operations = await this.storeService.getWithSpecification(null, null, null, relations);
            return operations;
        }

    }
    @Get("get-stores-by-workhouse-id/:workhouseId")
    @ApiTags('Stores')
    @ApiOperation({ summary: 'Stores list by workhouse id' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return stores list.', type: Stores })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getStoresByWorkhouseId(@Param('workhouseId') workhouseId: number): Promise<Stores[]> {
        const relations: FindOptionsRelations<Stores> = {
            region: true,
            workhouse: true
        };

        var spec = new StoreByWorkhouseSpecification(workhouseId);
        var operations = await this.storeService.getWithSpecification(spec, null, null, relations);

        return operations;
    }


    @Get("get-store-by-id/:id")
    @ApiTags('Stores')
    @ApiOperation({ summary: 'Stores' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return store.', type: Stores })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getStoreById(@Param('id') id: number,@Req() req: any, @Query('rolename') rolename?: string): Promise<Stores> {
        var specStore = new StoreSpecification(id);
        const relations: FindOptionsRelations<Stores> = {
            region: true,
            storeTransactions: true,
            workhouse: true
        };
        //var operations = await this.storeService.getWithSpecification(specStore, null, null, relations);
        if (rolename) {
            var spec = new UserRoleSpecification(rolename, req.user.userid);
            var userRoleId = await this.userRoleService.getWithSpecification(spec, null, { id: true }, null);
            var workPlaces = await this.personnelWorkPlacesService.getWithSpecification(new PersonnelWorkPlacesBytypeAndUserRoleIdSpecification(userRoleId[0].id, WorkPlaceType.Store), null, { placeId: true }, null);
            var operations = await this.storeService.getWithSpecification(specStore, null, null, relations);
            operations = operations.filter(w => workPlaces.findIndex(wp => wp.placeId === w.id) > -1);
            return operations[0];
        } else {
            var operations = await this.storeService.getWithSpecification(specStore, null, null, relations);
            return operations[0];
        }

        //return operations[0];
    }

    @Post("create-store")
    @ApiTags('Stores')
    @ApiOperation({ summary: 'create new store' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return created store.', type: Stores })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewStore(@Body() storeDto: CreateStoreDto, @Request() req): Promise<Stores> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );
        var spec = new StoreCodeSpecification(storeDto.code);
        var chekCode = await this.storeService.getWithSpecification(spec);
        if (chekCode && chekCode.length > 0) {
            throw new HttpException("Store with this code already exists!", HttpStatus.BAD_REQUEST);
        }
        const store = new Stores();
        store.name = storeDto.name;
        store.code = storeDto.code;
        store.address = storeDto.address;
        store.region = { id: storeDto.regionId } as Regions;
        store.workhouse = { id: storeDto.workhouseId } as Workhouses;
        store.createAt = new Date();
        store.recordStatus = recordStatus.Active;
        store.user = checkUser;

        await this.storeService.add(store);
        return store;
    }

    @Put("update-store")
    @ApiTags('Stores')
    @ApiOperation({ summary: 'update store' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return updated store.', type: Stores })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateStore(@Body() storeDto: UpdateStoreDto, @Request() req): Promise<Stores> {
        const user = req.user;
        var store = await this.storeService.getById(storeDto.id);
        if (!store) {
            throw new HttpException("The store is not found!", HttpStatus.NOT_FOUND);
        }
        if (storeDto.code) {
            var spec = new StoreCodeAndNotIdSpecification(storeDto.code, storeDto.id);
            var chekCode = await this.storeService.getWithSpecification(spec);
            if (chekCode && chekCode.length > 0) {
                throw new HttpException("Store with this code already exists!", HttpStatus.BAD_REQUEST);
            }
        }

        store.name = storeDto.name ?? store.name;
        store.code = storeDto.code ?? store.code;
        store.address = storeDto.address ?? store.address;
        if (storeDto.regionId != undefined && storeDto.regionId != null) {
            store.region = { id: storeDto.regionId ?? store.region.id } as Regions;
        }
        if (storeDto.workhouseId != undefined && storeDto.workhouseId != null) {
            store.workhouse = { id: storeDto.workhouseId ?? store.workhouse.id } as Workhouses;
        }
        store.recordStatus = storeDto.recordStatus ?? store.recordStatus;
        await this.storeService.update(store);
        return await this.storeService.getById(storeDto.id);
    }
    @Delete("delete-store/:storeId")
    @ApiTags('Stores')
    @ApiOperation({ summary: 'remove store' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfully.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteStore(@Param('storeId') storeId: number): Promise<boolean> {
        await this.storeService.delete(storeId);
        return true;
    }

    //#endregion


    //#region Car Warehouses

    @Get("get-car-warehouses")
    @ApiTags('Car Warehouses')
    @ApiOperation({ summary: 'Car Warehouses list' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return  car warehouses list.', type: CarWarehouses })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getCarWarehouses(@Req() req: any, @Param('rolename') rolename?: string): Promise<CarWarehouses[]> {
        const relations: FindOptionsRelations<CarWarehouses> = {
            region: true,

        };

        if (rolename) {
            var spec = new UserRoleSpecification(rolename, req.user.userid);
            var userRoleId = await this.userRoleService.getWithSpecification(spec, null, { id: true }, null);
            var workPlaces = await this.personnelWorkPlacesService.getWithSpecification(new PersonnelWorkPlacesBytypeAndUserRoleIdSpecification(userRoleId[0].id, WorkPlaceType.CarWarehouse), null, { placeId: true }, null);
            var operations = await this.carWarehouseService.getWithSpecification(null, null, null, relations);
            operations = operations.filter(w => workPlaces.some(wp => wp.placeId === w.id));
            return operations;
        } else {

            var operations = await this.carWarehouseService.getWithSpecification(null, null, null, relations);

            return operations;
        }
    }
    @Get("get-car-warehouse-by-id/:id")
    @ApiTags('Car Warehouses')
    @ApiOperation({ summary: 'Car Warehouses' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return car warehouse.', type: CarWarehouses })
    @UseGuards(JwtAuthGuard, AdminAndClientRolesGuard)
    @ApiBearerAuth()
    async getCarWarehouseById(@Param('id') id: number, @Req() req: any, @Param('rolename') rolename?: string): Promise<CarWarehouses> {
        var specCarWare = new CarWarehouseSpecification(id);
        const relations: FindOptionsRelations<CarWarehouses> = {
            region: true,

        };

        if (rolename) {
            var spec = new UserRoleSpecification(rolename, req.user.userid);
            var userRoleId = await this.userRoleService.getWithSpecification(spec, null, { id: true }, null);
            var workPlaces = await this.personnelWorkPlacesService.getWithSpecification(new PersonnelWorkPlacesBytypeAndUserRoleIdSpecification(userRoleId[0].id, WorkPlaceType.CarWarehouse), null, { placeId: true }, null);
            var operations = await this.carWarehouseService.getWithSpecification(specCarWare, null, null, relations);
            operations = operations.filter(w => workPlaces.some(wp => wp.placeId === w.id));
            return operations[0];
        } else {

            var operations = await this.carWarehouseService.getWithSpecification(specCarWare, null, null, relations);

            return operations[0];
        }
    }

    @Post("create-car-warehouse")
    @ApiTags('Car Warehouses')
    @ApiOperation({ summary: 'create new car warehouse' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return created car warehouse.', type: CarWarehouses })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async createNewCarWarehouse(@Body() warehouseDto: CreateCarWarehousesDto, @Request() req): Promise<CarWarehouses> {
        const user = req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
            user_specification,
            null,
            { id: true }
        );
        var spec = new CarWarehouseCodeSpecification(warehouseDto.code);
        var chekCode = await this.carWarehouseService.getWithSpecification(spec);
        if (chekCode && chekCode.length > 0) {
            throw new HttpException("Car Warehouse with this code already exists!", HttpStatus.BAD_REQUEST);
        }
        const warehouse = new CarWarehouses();
        warehouse.name = warehouseDto.name;
        warehouse.code = warehouseDto.code;
        warehouse.address = warehouseDto.address;
        warehouse.region = { id: warehouseDto.regionId } as Regions;
        warehouse.createAt = new Date();
        warehouse.recordStatus = recordStatus.Active;
        warehouse.user = checkUser;

        await this.carWarehouseService.add(warehouse);
        return warehouse;
    }

    @Put("update-car-warehouse")
    @ApiTags('Car Warehouses')
    @ApiOperation({ summary: 'update car warehouse' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return updated car warehouse.', type: CarWarehouses })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async updateCarWarehouse(@Body() warehouseDto: UpdateCarWarehousesDto, @Request() req): Promise<CarWarehouses> {
        const user = req.user;
        var warehouse = await this.carWarehouseService.getById(warehouseDto.id);
        if (!warehouse) {
            throw new HttpException("The carwarehouse is not found!", HttpStatus.NOT_FOUND);
        }
        if (warehouseDto.code) {
            var spec = new CarWarehouseCodeAndNotIdSpecification(warehouseDto.code, warehouseDto.id);
            var chekCode = await this.carWarehouseService.getWithSpecification(spec);
            if (chekCode && chekCode.length > 0) {
                throw new HttpException("Car Warehouse with this code already exists!", HttpStatus.BAD_REQUEST);
            }
        }

        warehouse.name = warehouseDto.name ?? warehouse.name;
        warehouse.code = warehouseDto.code ?? warehouse.code;
        warehouse.address = warehouseDto.address ?? warehouse.address;
        if (warehouseDto.regionId != undefined && warehouseDto.regionId != null) {
            warehouse.region = { id: warehouseDto.regionId ?? warehouse.region.id } as Regions;
        }
        warehouse.recordStatus = warehouseDto.recordStatus ?? warehouse.recordStatus;
        await this.carWarehouseService.update(warehouse);
        return await this.carWarehouseService.getById(warehouseDto.id);
    }
    @Delete("delete-car-warehouse/:warehouseId")
    @ApiTags('Car Warehouses')
    @ApiOperation({ summary: 'remove car warehouse' })
    @ApiResponse({ status: HttpStatus.OK, description: 'return true if removed successfully.', type: Boolean })
    @UseGuards(JwtAuthGuard, AdminRolesGuard)
    @ApiBearerAuth()
    async deleteCarWarehouse(@Param('warehouseId') warehouseId: number): Promise<boolean> {
        await this.carWarehouseService.delete(warehouseId);
        return true;
    }




    //#endregion



}


