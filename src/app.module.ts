import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserModule } from './application/services/user/appModuls/user.module';
import { AuthModule } from './auth/auth.module';
import { Roles } from 'src/domain/entities/Roles';
import { UserRoles } from 'src/domain/entities/UserRoles';
import { Users } from 'src/domain/entities/Users';
import { ThrottlerModule } from '@nestjs/throttler';
import { MulterModule } from '@nestjs/platform-express';
import { fileUploadOptions } from './interceptors/file-option';
import { ServeStaticModule } from '@nestjs/serve-static';
import * as path from 'path';
import { CarFuels } from './domain/entities/CarFuels';
import { ConsignedCars } from './domain/entities/ConsignedCars';
import { Regions } from './domain/entities/Regions';
import { Providers } from './domain/entities/Providers';
import { InvoiceDetails } from './domain/entities/InvoiceDetails';
import { InvoiceHeaders } from './domain/entities/InvoiceHeaders';
import { ItemUnits } from './domain/entities/ItemUnits';
import { Items } from './domain/entities/Items';
import { ChannelRowItems } from './domain/entities/ChannelRowItems';
import { ChannelRows } from './domain/entities/ChannelRows';
import { Networks } from './domain/entities/Networks';
import { Works } from './domain/entities/Works';
import { WorkhouseDetails } from './domain/entities/WorkhouseDetails';
import { Workhouses } from './domain/entities/Workhouses';
import { Courses } from './domain/entities/Courses';
import { CourseParticipants } from './domain/entities/CourseParticipants';
import { Personnels } from './domain/entities/Personnels';
import { Leaves } from './domain/entities/Leaves';
import { LeaveHistories } from './domain/entities/LeaveHistories';
import { PersonnelConsigneds } from './domain/entities/PersonnelConsigneds';
import { Consignments } from './domain/entities/Consignments';
import { PersonnelWorkPlaces } from './domain/entities/PersonnelWorkPlaces';
import { Positions } from './domain/entities/Positions';
import { SystemOperations } from './domain/entities/SystemOperations';
import { Projects } from './domain/entities/Projects';
import { ProjectPlanings } from './domain/entities/ProjectPlanings';
import { ProjectPlanningImplementation } from './domain/entities/ProjectPlanningImplementation';
import { ForceMajors } from './domain/entities/ForceMajors';
import { ProjectFirms } from './domain/entities/ProjectFirms';
import { Rollcalls } from './domain/entities/Rollcalls';
import { Teachers } from './domain/entities/Teachers';
import { Stores } from './domain/entities/Stores';
import { StoreDispatchHeaders } from './domain/entities/StoreDispatchHeaders';
import { StoreDispatchDetails } from './domain/entities/StoreDispatchDetails';
import { ReceiptDetails } from './domain/entities/ReceiptDetails';
import { WarehouseDispatchDetails } from './domain/entities/WarehouseDispatchDetails';
import { StoreReceiptDetails } from './domain/entities/StoreReceiptDetails';
import { StoreReceiptHeaders } from './domain/entities/StoreReceiptHeaders';
import { StoreTransactions } from './domain/entities/StoreTransactions';
import { WarehouseDispatchHeaders } from './domain/entities/WarehouseDispatchHeaders';
import { WarehouseDispatchHeaderStatusHistories } from './domain/entities/WarehouseDispatchHeaderStatusHistories';
import { Warehouses } from './domain/entities/Warehouses';
import { WarehouseTransactions } from './domain/entities/WarehouseTransactions';
import { Drivers } from './domain/entities/Drivers';
import { DriverVehicles } from './domain/entities/DriverVehicles';
import { ReceiptHeaders } from './domain/entities/ReceiptHeaders';
import { StoreDispatchHeaderStatusHistories } from './domain/entities/StoreDispatchHeaderStatusHistories';
import { TenderHeaders } from './domain/entities/TenderHeaders';
import { TenderDetails } from './domain/entities/TenderDetails';
import { OrderHeaders } from './domain/entities/OrderHeaders';
import { OrderDetails } from './domain/entities/OrderDetails';
import { OrderHeaderStatusHistories } from './domain/entities/OrderHeaderStatusHistories';
import { TransmissionRows } from './domain/entities/TransmissionRows';
import { TransmissionRowItmes } from './domain/entities/TransmissionRowItmes';
import { ProductTypes } from './domain/entities/ProductTypes';
import { Categories } from './domain/entities/Categories';
import { InvoiceHeaderStatusHistories } from './domain/entities/InvoiceHeaderStatusHistories';
import { AdminModule } from './application/services/admin/appModule/admin.module';
import { Menus } from './domain/entities/Menus';
import { MenuOperations } from './domain/entities/MenuOperations';
import { RoleMenuOperations } from './domain/entities/RoleMenuOperations';
import { UserMenuOperations } from './domain/entities/UserMenuOperations';
import { TenderCategories } from './domain/entities/TenderCategories';
import { NetworkTrAdis } from './domain/entities/NetworkTrAdis';
import { TransmissionSummary } from './domain/entities/TransmissionSummary';
import { WarehouseModule } from './application/services/warehouse/appModuls/warehouse.module';
import { InvoiceNos } from './domain/entities/InvoiceNos';
import { ReceiptNos } from './domain/entities/ReceiptNos';
import { WarehouseDispatchNo } from './domain/entities/WarehouseDispatchNos';
import { StoreReceiptNos } from './domain/entities/StoreReceiptNos';
import { StoreDispatchNo } from './domain/entities/StoreDispatchNos';
import { ProjectPlanningImplementationDates } from './domain/entities/ProjectPlanningImplementaionDates';
import { HrModule } from './application/services/hr/appModule/hr.module';
import { NotificationsModule } from './application/services/notificatin/notifications.module';
import { SystemNotifications } from './domain/entities/SystemNotifications';
import { Requests } from './domain/entities/Requests';
import { RequestStatusHistories } from './domain/entities/RequestStatusHistories';
import { WorkhouseRents } from './domain/entities/WorkhouseRents';
import { WorkhouseRentStatusHistories } from './domain/entities/WorkkhouseRentStatusHistories';
import { ConsignmentNos } from './domain/entities/ConsignmentNos';
import { CarWarehouses } from './domain/entities/CarWarehouses';
import { CarWarehouseDetails } from './domain/entities/CarWarehouseDetails';
import { EducationModule } from './application/services/education/appModule/education.module';
import { CourseDateTimes } from './domain/entities/CourseDateTimes';
import { CommiteMembers } from './domain/entities/CommiteMembers';
import { ConfirmationProjectReport } from './domain/entities/ConfirmationProjectReport';
import { ConfirmationReportCommiteMember } from './domain/entities/ConfirmationReportCommiteMember';
import { ConfirmationReportCommiteMemberAnswer } from './domain/entities/ConfirmationReportCommiteMemberAnswer';
import { ReportModule } from './application/services/report/appModule/report.module';
import { PersonnelSalary } from './domain/entities/PersonnelSalary';
import { NotificationLists } from './domain/entities/NotificationLists';
import { RoleNotificationLists } from './domain/entities/RoleNotificationLists';
import { UserNotificationLists } from './domain/entities/UserNotificationLists';
import { OllamaAssistantService } from './agent/ollama-assistant.service';
import { AgentAssistantController } from './presentation/controllers/admin/agent-assistant.controller';
import { ToolRegisterModule } from './application/services/agent/appModule/toolregister.module';
import { ContextManagerModule } from './application/services/agent/appModule/contextManager.module';
import { ConversationSession } from './application/services/agent/entities/ConversationSession';
import { PromptSubmission } from './application/services/agent/entities/PromptSubmission';
import { ToolExecution } from './application/services/agent/entities/ToolExecution';
import { TelegramLink } from './application/services/agent/entities/TelegramLink';
import { TelegramLinkCode } from './application/services/agent/entities/TelegramLinkCode';
import { WhatsappModule } from './application/services/agent/appModule/whatsapp.module';
import { WhatsappAuthCredential } from './application/services/agent/entities/WhatsappAuthCredential';
import { WhatsappAuthKey } from './application/services/agent/entities/WhatsappAuthKey';
import { WhatsappUserMapping } from './application/services/agent/entities/WhatsappUserMapping';

@Module({
  imports: [
    ServeStaticModule.forRoot({
     rootPath: path.join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',    },
      {
    rootPath: path.join(__dirname, '..', 'cdn'),
    serveRoot: '/cdn',
  }),
    MulterModule.registerAsync({
      useFactory: () => fileUploadOptions,
    }),
    ThrottlerModule.forRoot([{
      ttl: 60000,
      limit: 10,
    }]),
    ConfigModule.forRoot({ isGlobal: true, // Makes the config available globally 
    envFilePath: '.env', // Specify the path to the .env file in the dist folder 
   
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      /* useFactory: typeOrmConfig, */
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', '123qwe$%'),
        database: configService.get<string>('DB_DATABASE', 'SetasportalDb'),
      /*   entities: ['domain/entities/*.ts'], */
       entities: [Users,CarFuels,ConsignedCars,CarWarehouseDetails,CarWarehouses,Regions,Providers,
        InvoiceDetails,InvoiceHeaders,ItemUnits,Items,ChannelRowItems,ChannelRows,Networks,Works,
        WorkhouseDetails,Workhouses,Courses,CourseParticipants,Personnels,Leaves,LeaveHistories,PersonnelConsigneds,
        Consignments,PersonnelWorkPlaces,Positions,UserRoles,Roles,SystemOperations,UserMenuOperations,
        PersonnelWorkPlaces,Projects,ProjectPlanings,ProjectPlanningImplementation,ForceMajors,ProjectFirms,
        Rollcalls,Teachers,Stores,StoreDispatchHeaders,StoreDispatchHeaders,StoreDispatchDetails,ReceiptDetails,WarehouseDispatchDetails,
        StoreReceiptDetails,StoreReceiptHeaders,StoreTransactions,WarehouseDispatchHeaders,WarehouseDispatchHeaderStatusHistories,Warehouses,WarehouseTransactions,
        Drivers,DriverVehicles,ReceiptHeaders,StoreDispatchHeaderStatusHistories,TenderHeaders,TenderDetails,OrderHeaders,
        OrderDetails,OrderHeaderStatusHistories,TransmissionRows,TransmissionRowItmes,ProductTypes,Categories,InvoiceHeaderStatusHistories,
        Menus,MenuOperations,RoleMenuOperations,TenderCategories,NetworkTrAdis,TransmissionSummary,InvoiceNos,ReceiptNos,WarehouseDispatchNo,
        StoreReceiptNos,StoreDispatchNo,ProjectPlanningImplementationDates,SystemNotifications,Requests,RequestStatusHistories,ConsignmentNos,
        WorkhouseRents,WorkhouseRentStatusHistories,CourseDateTimes,CommiteMembers,ConfirmationProjectReport,
        ConfirmationReportCommiteMember,ConfirmationReportCommiteMemberAnswer,PersonnelSalary,NotificationLists,
        RoleNotificationLists,UserNotificationLists,ConversationSession,PromptSubmission,ToolExecution,TelegramLink,
        TelegramLinkCode,WhatsappAuthCredential,WhatsappAuthKey,WhatsappUserMapping
       ],
        migrations: ['domain/migrations/*.ts'],
          migrationsRun: false,   
         synchronize: false, // Disable auto schema synchronization
        logging: true, // ['error'], // Log only errors
        logger: 'advanced-console',
    }),
    }),
    /* ConfigModule.forRoot({ load: [typeormConfig] }), */
    ConfigModule.forRoot({
     
      isGlobal: true,  // Makes the config available globally
    }),
    AuthModule,
    UserModule,
    AdminModule,
    WarehouseModule,
    HrModule,
    NotificationsModule,
    EducationModule,
    ReportModule,
    ToolRegisterModule,
    ContextManagerModule,
    WhatsappModule
  ],
  controllers: [AgentAssistantController],
  providers: [OllamaAssistantService],
})
export class AppModule {}
