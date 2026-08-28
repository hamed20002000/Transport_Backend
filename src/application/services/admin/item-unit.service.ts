import { forwardRef, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { SystemOperations } from 'src/domain/entities/SystemOperations';
import { SystemOperationRepository } from 'src/infrastructure/repositories/admin/system-operation.repository';
import { ItemUnits } from 'src/domain/entities/ItemUnits';
import { ItemUnitRepository } from 'src/infrastructure/repositories/admin/item-unit.repository';
import { ToolRegister } from '../agent/toolRegister';
import { ContextManager } from '../agent/contextManager';
import { UserService } from '../user/user.service';
import { RequestResult } from '../agent/types';
import messages from '../agent/localFiles/messages.json'
import { HttpService } from '@nestjs/axios';
import { CreateItemUnitDto, UpdateItemUnitDto } from 'src/presentation/dtos/baseinfo/item-unit.dto';
import { UserSpecification } from 'src/application/specifications/user/user-specifications';
import { ItemUnitSpecification } from 'src/application/specifications/admin/item-unit-specifications';
import { GenericMapper } from 'src/presentation/helpers/mapper-classes';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';

@Injectable()
export class ItemUnitService extends BaseService<ItemUnits> {
  constructor(

    private readonly itemUnitRepository: ItemUnitRepository,
    private readonly history: ContextManager,
    private readonly toolRegister: ToolRegister,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
  ) {
    super(itemUnitRepository);
  }


  onModuleInit() {
    this.toolRegister.register({
      functionName: "create_item_unit",
      handler: async (param: any): Promise<RequestResult> => {

        if (param.title == undefined || param.title.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "create_item_unit",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.unit.namerequired
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.unit.namerequired, HttpStatus.BAD_REQUEST);
        }


        var itemUnitDto = new CreateItemUnitDto();
        itemUnitDto.title = this.toolRegister.normalizingName(param.title);

        var user = param.req.user;
        const user_specification = new UserSpecification(user.username);
        var checkUser = await this.userService.getWithSpecification(user_specification, null,
          {
            id: true

          });
        var specification = new ItemUnitSpecification(itemUnitDto.title.trim());
        var check = await this.getWithSpecification(specification);
        if (check.length > 0) {

          this.history.addNewHistory({
            status: "fault",
            operation: "create_item_unit",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.unit.unitalreadyexist
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.unit.unitalreadyexist, HttpStatus.BAD_REQUEST);
        }
        var item = GenericMapper.toEntity(ItemUnits, itemUnitDto);
        item.title = itemUnitDto.title.trim();
        item.createAt = new Date();
        item.recordStatus = recordStatus.Active;
        item.user = checkUser[0];

        var createdItem = await this.add(item);

        this.history.addNewHistory({
          status: "success",
          operation: "create_item_unit",
          parameters: this.history.getParams(param),
          result: {
            "id": createdItem.id.toString(),
            "title": createdItem.title,
            "createAt": createdItem.createAt.toString(),
            "recordStatus": createdItem.recordStatus.toString(),

          }
        }, param.req.user.username,param.sessionId)

        return {
          continuePrompt: undefined,
          toolName: "create_item_unit"
        }
      }
    })

    this.toolRegister.register({
      functionName: "update_item_unit",
      handler: async (param: any): Promise<RequestResult> => {
        if (param.title == undefined || param.title.replaceAll(" ", "") == "" || param.newtitle == undefined || param.newtitle.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_item_unit",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.unit.nameandnewNameisrequired
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.unit.nameandnewNameisrequired, HttpStatus.BAD_REQUEST);
        }



        var itemUnitDto = new UpdateItemUnitDto();
        itemUnitDto.newTitle = param.newtitle
        itemUnitDto.recordStatus = param.recordStatus


        var specification = new ItemUnitSpecification(param.title);
        var checkUnit = await this.getWithSpecification(specification);

        var checkItemUnit = await this.getById(itemUnitDto.id);
        if (checkUnit.length < 1) {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_item_unit",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.unit.itemunitfound
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.unit.itemunitfound, HttpStatus.NOT_FOUND);
        }

        if (itemUnitDto?.newTitle != null && itemUnitDto?.newTitle != undefined) {
          var specification = new ItemUnitSpecification(itemUnitDto.newTitle.trim());
          var check = await this.getWithSpecification(specification);
          if (check.length > 0) {
            this.history.addNewHistory({
              status: "fault",
              operation: "update_item_unit",
              parameters: this.history.getParams(param),
              result: {
                errorMessage: messages.unit.unitalreadyexist
              }
            }, param.req.user.username,param.sessionId)
            throw new HttpException(messages.unit.unitalreadyexist, HttpStatus.BAD_REQUEST);
          }
          checkItemUnit.title = itemUnitDto?.newTitle.trim() ?? checkItemUnit.title;
        }


        checkItemUnit.recordStatus = itemUnitDto.recordStatus ?? checkItemUnit.recordStatus;
        var updateItmeUnit = await this.update(checkItemUnit);

        this.history.addNewHistory({
          status: "success",
          operation: "update_item_unit",
          parameters: this.history.getParams(param),
          result: {
            "id": updateItmeUnit.id.toString(),
            "name": updateItmeUnit.title,
            "newname": itemUnitDto.newTitle,
            "createAt": updateItmeUnit.createAt.toString(),
            "recordStatus": updateItmeUnit.recordStatus.toString(),
          }
        }, param.req.user.username,param.sessionId)

        return {
          continuePrompt: undefined,
          toolName: "update_item_unit"
        }

      }
    })


    this.toolRegister.register({
      functionName: "delete_item_unit",
      handler: async (param: any): Promise<RequestResult> => {

        if (param.title == undefined || param.title.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "delete_item_unit",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.unit.namerequired
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.unit.namerequired, HttpStatus.BAD_REQUEST);
        }


        const deleteUnitItemTitle = this.toolRegister.normalizingName(param.title);


        var specification = new ItemUnitSpecification(deleteUnitItemTitle);
        var checkUnitItem = await this.getWithSpecification(specification);
        if (checkUnitItem.length < 1) {
          this.history.addNewHistory({
            status: "fault",
            operation: "delete_item_unit",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.unit.itemunitfound
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.unit.itemunitfound, HttpStatus.NOT_FOUND);
        }

        var createRole = await this.delete(checkUnitItem[0].id);
        this.history.addNewHistory({
          status: "success",
          operation: "delete_item_unit",
          parameters: this.history.getParams(param),
          result: {
            "id": checkUnitItem[0].id.toString(),
            "title": deleteUnitItemTitle,
          }
        }, param.req.user.username,param.sessionId)


        return {
          continuePrompt: undefined,
          toolName: "delete_item_unit"
        };
      }
    })

    this.toolRegister.register({
      functionName: "update_item_unit_record_status",
      handler: async (param: any): Promise<RequestResult> => {
        var itemUnitDto = new UpdateItemUnitDto();
        itemUnitDto.recordStatus = param.recordStatus;

        if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_item_unit_record_status",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.unit.namerequired
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.unit.namerequired, HttpStatus.BAD_REQUEST);
        }
        var specification = new ItemUnitSpecification(param.name);
        var checkItemUnit = await this.getWithSpecification(specification);
        if (checkItemUnit.length < 1) {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_item_unit_record_status",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.unit.itemunitfound
            }
          }, param.req.user.username,param.sessionId)

          throw new HttpException(messages.unit.itemunitfound, HttpStatus.NOT_FOUND);
        }
        checkItemUnit[0].recordStatus = itemUnitDto.recordStatus ?? checkItemUnit[0].recordStatus;

        var updateItemUnit = await this.update(checkItemUnit[0]);
        this.history.addNewHistory({
          status: "success",
          operation: "update_item_unit_record_status",
          parameters: this.history.getParams(param),
          result: {
            "id": updateItemUnit.id.toString(),
            "title": checkItemUnit[0].title,
            "recordStatus": updateItemUnit.recordStatus.toString(),
          }
        }, param.req.user.username,param.sessionId)

        return {
          continuePrompt: undefined,
          toolName: "update_item_unit_record_status"
        };
      }
    })



  }

   async findByName(title: string): Promise<ItemUnits> {
          return await this.itemUnitRepository.findByName(title)
              
      }

}