import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/auth/auth.module';
import { Categories } from 'src/domain/entities/Categories';
import { BaseinfoController } from 'src/presentation/controllers/admin/baseinfo.controller';
import { CategoryRepository } from 'src/infrastructure/repositories/admin/category.repository';
import { CategoryService } from '../category.service';
import { UserRepository } from 'src/infrastructure/repositories/user/user.repository';
import { UserService } from '../../user/user.service';
import { Users } from 'src/domain/entities/Users';


import { UserRoleRepository } from 'src/infrastructure/repositories/user/user-role.repository';
import { UserRoles } from 'src/domain/entities/UserRoles';
import { ItemUnitRepository } from 'src/infrastructure/repositories/admin/item-unit.repository';
import { ItemUnitService } from '../item-unit.service';
import { ItemUnits } from 'src/domain/entities/ItemUnits';
import { Items } from 'src/domain/entities/Items';
import { ItemRepository } from 'src/infrastructure/repositories/admin/item.repository';
import { ItemService } from '../item.service';
import { TenderRepository } from 'src/infrastructure/repositories/admin/tender.repository';
import { TenderService } from '../tender.service';
import { TenderHeaders } from 'src/domain/entities/TenderHeaders';
import { InitialOperationsController } from 'src/presentation/controllers/admin/initial-operation.controller';
import { TenderDetails } from 'src/domain/entities/TenderDetails';
import { Menus } from 'src/domain/entities/Menus';
import { MenuRepository } from 'src/infrastructure/repositories/admin/menu.repository';
import { MenuService } from '../menu.servic';
import { MenuOperationRepository } from 'src/infrastructure/repositories/admin/menu-operation.repository';
import { MenuOperationService } from '../menu-operation.service';
import { MenuOperations } from 'src/domain/entities/MenuOperations';
import { SystemOperationRepository } from 'src/infrastructure/repositories/admin/system-operation.repository';
import { SystemOperationService } from '../system-operation.service';
import { SystemOperations } from 'src/domain/entities/SystemOperations';
import { UserMenuOperations } from 'src/domain/entities/UserMenuOperations';
import { UserMenuOperationRepository } from 'src/infrastructure/repositories/user/user-menu-operation.repository';
import { TenderCategories } from 'src/domain/entities/TenderCategories';
import { WorkService } from '../work.service';
import { WorkRepository } from 'src/infrastructure/repositories/admin/work.repository';
import { Works } from 'src/domain/entities/Works';
import { ProductTypes } from 'src/domain/entities/ProductTypes';
import { Networks } from 'src/domain/entities/Networks';
import { ProductTypeRepository } from 'src/infrastructure/repositories/admin/product-type.repository';
import { ProductTypeService } from '../product-type.service';
import { NetworkRepository } from 'src/infrastructure/repositories/admin/network.repository';
import { NetworkService } from '../network.service';
import { TransmissionRows } from 'src/domain/entities/TransmissionRows';
import { TransmissionRowRepository } from 'src/infrastructure/repositories/admin/transmission-row.repository';
import { TransmissionRowService } from '../transmission-row.service';
import { TransmissionRowItmes } from 'src/domain/entities/TransmissionRowItmes';
import { TransmissionSummary } from 'src/domain/entities/TransmissionSummary';
import { TransmissionSummaryService } from '../transmission-summary.service';
import { TransmissionSummaryRepository } from 'src/infrastructure/repositories/admin/transmission-summary.repository';
import { Regions } from 'src/domain/entities/Regions';
import { RegionService } from '../region.service';
import { RegionRepository } from 'src/infrastructure/repositories/admin/region.repository';
import { WorkhouseRepository } from 'src/infrastructure/repositories/admin/workhouse.repository';
import { WorkhouseService } from '../workhouse.service';
import { Workhouses } from 'src/domain/entities/Workhouses';
import { WorkhouseDetails } from 'src/domain/entities/WorkhouseDetails';
import { WorkhouseDetailService } from '../workhouse-detail.service';
import { WorkhouseDetailsRepository } from 'src/infrastructure/repositories/admin/workhouse-detail.repository';
import { Warehouses } from 'src/domain/entities/Warehouses';
import { WarehouseService } from '../warehouse.service';
import { WarehouseRepository } from 'src/infrastructure/repositories/admin/warehouse.repository';
import { OrderHeaders } from 'src/domain/entities/OrderHeaders';
import { OrderDetails } from 'src/domain/entities/OrderDetails';
import { OrderHeaderStatusHistories } from 'src/domain/entities/OrderHeaderStatusHistories';
import { OrderHeaderStatusHistoriesService } from '../orderHeaderStatusHistories.service';
import { OrderHeaderStatusHistoriesRepository } from 'src/infrastructure/repositories/admin/orderHeaderStatusHistories.repository';
import { OrderService } from '../order.service';
import { OrderRepository } from 'src/infrastructure/repositories/admin/order.repository';
import { Providers } from 'src/domain/entities/Providers';
import { ProviderRepository } from 'src/infrastructure/repositories/admin/provider.repository';
import { ProviderService } from '../provider.service';
import { InvoiceHeaderStatusHistories } from 'src/domain/entities/InvoiceHeaderStatusHistories';
import { InvoiceHeaders } from 'src/domain/entities/InvoiceHeaders';
import { InvoiceDetails } from 'src/domain/entities/InvoiceDetails';
import { InvoiceService } from '../../sale/invoice.service';
import { InvoiceRepository } from 'src/infrastructure/repositories/sale/invoice.repository';
import { InvoiceHeaderStatusHistoriesService } from '../../sale/invoiceHeaderStatusHistories.service';
import { InvoiceHeaderStatusHistoriesRepository } from 'src/infrastructure/repositories/sale/invoiceHeaderStatusHistories.repository';
import { WarehouseTransactions } from 'src/domain/entities/WarehouseTransactions';
import { Stores } from 'src/domain/entities/Stores';
import { StoreTransactions } from 'src/domain/entities/StoreTransactions';
import { StoreService } from '../store.service';
import { StoreRepository } from 'src/infrastructure/repositories/admin/store.repository';
import { NotificationsGateway } from '../../notificatin/notifications.gateway';
import { SystemNotifications } from 'src/domain/entities/SystemNotifications';
import { SystemNotificationsRepository } from 'src/infrastructure/repositories/notification/system-notifications.repository';
import { SystemNotificationsService } from '../../notificatin/systemNotifications.service';
import { WorkhouseRentsRepository } from 'src/infrastructure/repositories/warehouse/workhouse-rent.repository';
import { WorkhouseRentsService } from '../../warehouse/workhouse-rent.service';
import { WorkhouseRentStatusHistories } from 'src/domain/entities/WorkkhouseRentStatusHistories';
import { WorkhouseRents } from 'src/domain/entities/WorkhouseRents';
import { CarWarehouses } from 'src/domain/entities/CarWarehouses';
import { CreateWarehouseDispatchDestructionDto } from 'src/presentation/dtos/warehouse/warhouse-dispatch-dto';
import { CarWarehouseRepository } from 'src/infrastructure/repositories/admin/carWarehouse.repository';
import { CarWarehouseService } from '../carWarhouse.service';
import { CarWarehousedetailRepository } from 'src/infrastructure/repositories/admin/carWarehouseDetail.repository';
import { CarWarehouseDetailService } from '../carWarhouseDetail.service';
import { CarWarehouseDetails } from 'src/domain/entities/CarWarehouseDetails';
import { PersonnelWorkPlaces } from 'src/domain/entities/PersonnelWorkPlaces';
import { PersonnelWorkPlacesService } from '../../hr/personnelWorkPlaces.service';
import { PersonnelWorkPlacesRepository } from 'src/infrastructure/repositories/hr/personnelWorkPlace.repository';
import { UserRoleService } from '../../user/userRole.service';
import { NotificationLists } from 'src/domain/entities/NotificationLists';
import { RoleNotificationLists } from 'src/domain/entities/RoleNotificationLists';
import { UserNotificationLists } from 'src/domain/entities/UserNotificationLists';
import { InsertTools } from 'src/agent/tools/insert_tools';
import { UserModule } from '../../user/appModuls/user.module';

import { AgentModule } from 'src/application/services/agent/appModule/agent.module';
import { FunctionCallService } from '../../agent/services/functioncall.service';
import { CondinateService } from '../../agent/services/condinate.service';
import { CancellationService } from '../../agent/services/cancellation.service';


@Module({
    imports: [
        TypeOrmModule.forFeature([Categories, Users, UserRoles, UserMenuOperations, ItemUnits, Items,
            TenderHeaders, TenderDetails, Menus, MenuOperations, SystemOperations, TenderCategories, Works, ProductTypes
            , Networks, TransmissionRows, TransmissionRowItmes, TransmissionSummary, Regions, Workhouses, WorkhouseDetails,
            Warehouses, OrderHeaders, OrderDetails, OrderHeaderStatusHistories, Providers, InvoiceHeaderStatusHistories,
            InvoiceHeaders, InvoiceDetails, Warehouses, WarehouseTransactions, Stores, StoreTransactions, SystemNotifications,
            WorkhouseRents, WorkhouseRentStatusHistories, CarWarehouses, CarWarehouseDetails, PersonnelWorkPlaces,
            NotificationLists, RoleNotificationLists, UserNotificationLists]),
        forwardRef(() => AuthModule),
        forwardRef(() => UserModule),
        AgentModule

    ],
    controllers: [BaseinfoController, InitialOperationsController],
    providers: [
        CategoryRepository,
        CategoryService,
        UserRepository,
        UserRoleRepository,
        UserMenuOperationRepository,
        ItemUnitRepository,
        ItemUnitService,
        ItemRepository,
        ItemService,
        TenderRepository,
        TenderService,
        MenuRepository,
        MenuService,
        MenuOperationRepository,
        MenuOperationService,
        SystemOperationRepository,
        SystemOperationService,
        WorkService,
        WorkRepository,
        ProductTypeRepository,
        ProductTypeService,
        NetworkRepository,
        NetworkService,
        TransmissionRowRepository,
        TransmissionRowService,
        TransmissionSummaryRepository,
        TransmissionSummaryService,
        RegionService,
        RegionRepository,
        WorkhouseRepository,
        WorkhouseService,
        WorkhouseDetailService,
        WorkhouseDetailsRepository,
        WarehouseRepository,
        WarehouseService,
        OrderHeaderStatusHistoriesRepository,
        OrderHeaderStatusHistoriesService,
        OrderService,
        OrderRepository,
        ProviderRepository,
        ProviderService,
        InvoiceService,
        InvoiceRepository,
        InvoiceHeaderStatusHistoriesService,
        InvoiceHeaderStatusHistoriesRepository,
        WarehouseRepository,
        StoreRepository, 
        StoreService, 
        NotificationsGateway, 
        SystemNotificationsRepository, 
        SystemNotificationsService,
         WorkhouseRentsRepository,
        WorkhouseRentsService, 
        CarWarehouseRepository,
         CarWarehouseService,
          CarWarehousedetailRepository,
           CarWarehouseDetailService, 
           PersonnelWorkPlacesService,
           PersonnelWorkPlacesRepository, 
           UserRoleRepository, 
           UserRoleService,
            InsertTools,
            FunctionCallService,
            CondinateService,
            CancellationService
    ],
    exports: [
        CategoryRepository,
        CategoryService,
        UserRepository,
        UserRoleRepository,
        UserMenuOperationRepository,
        ItemUnitRepository,
        ItemUnitService,
        ItemRepository,
        ItemService,
        TenderRepository,
        TenderService,
        MenuRepository,
        MenuService,
        MenuOperationRepository,
        MenuOperationService,
        SystemOperationRepository,
        SystemOperationService,
        WorkService,
        WorkRepository,
        ProductTypeRepository,
        ProductTypeService,
        NetworkRepository,
        NetworkService,
        TransmissionRowRepository,
        TransmissionRowService,
        TransmissionSummaryRepository,
        TransmissionSummaryService,
        RegionService,
        RegionRepository,
        WorkhouseRepository,
        WorkhouseService,
        WorkhouseDetailService,
        WorkhouseDetailsRepository,
        WarehouseRepository,
        WarehouseService,
        OrderHeaderStatusHistoriesRepository,
        OrderHeaderStatusHistoriesService,
        OrderService,
        OrderRepository,
        ProviderRepository,
        ProviderService,
        InvoiceService,
        InvoiceRepository,
        InvoiceHeaderStatusHistoriesService,
        InvoiceHeaderStatusHistoriesRepository,
        WarehouseRepository,
        StoreRepository,
         StoreService, 
         NotificationsGateway, 
         SystemNotificationsRepository, 
         SystemNotificationsService, 
         WorkhouseRentsRepository,
        WorkhouseRentsService, 
        CarWarehouseRepository, 
        CarWarehouseService,
         CarWarehousedetailRepository, 
         CarWarehouseDetailService, 
         PersonnelWorkPlacesService,
         PersonnelWorkPlacesRepository, 
         UserRoleRepository,
          UserRoleService, 
          InsertTools,
            FunctionCallService,
            CondinateService,
            CancellationService
    ]
})
export class AdminModule { } 