import { forwardRef, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { SystemOperations } from 'src/domain/entities/SystemOperations';
import { SystemOperationRepository } from 'src/infrastructure/repositories/admin/system-operation.repository';
import { ProductTypes } from 'src/domain/entities/ProductTypes';
import { ProductTypeRepository } from 'src/infrastructure/repositories/admin/product-type.repository';
import { ContextManager } from '../agent/contextManager';
import { ToolRegister } from '../agent/toolRegister';
import { CategoryService } from './category.service';
import { UserService } from '../user/user.service';
import { RequestResult } from '../agent/types';
import messages from '../agent/localFiles/messages.json'
import { UsernameSpecification } from 'src/application/specifications/user/user-specifications';
import { CreateProductTypeDto, UpdateProductTypeDto } from 'src/presentation/dtos/initial-operations/product-type-dto';
import { ProductType } from 'src/domain/enums/productType-type.enum';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { Specification } from 'src/domain/specifications/base.specification';


@Injectable()
export class ProductTypeService extends BaseService<ProductTypes> {
  constructor(

    private readonly productTypeRepository: ProductTypeRepository,
    private readonly history: ContextManager,
    private readonly toolRegister: ToolRegister,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
  ) {
    super(productTypeRepository);
  }

  onModuleInit() {
    this.toolRegister.register({
      functionName: "create_pole_or_transformer",
      handler: async (param: any): Promise<RequestResult> => {

        if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "create_product",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.poletrafo.nameisrequired
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.poletrafo.nameisrequired, HttpStatus.BAD_REQUEST);
        }

        if (param.type == undefined || param.type.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "create_product",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.poletrafo.typeisrequired
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.poletrafo.typeisrequired, HttpStatus.BAD_REQUEST);
        }
        const user = param.req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
          user_specification,
          null,
          { id: true }
        );

        const productTypeDto = new CreateProductTypeDto();
        productTypeDto.name = this.toolRegister.normalizingName(param.name);
        productTypeDto.type = this.extractProductType(param.type)

        const productType = new ProductTypes();
        productType.name = productTypeDto.name.trim();
        productType.type = productTypeDto.type;
        productType.createAt = new Date();
        productType.recordStatus = recordStatus.Active;
        productType.user = checkUser;

        const createdProductType = await this.add(productType);


        this.history.addNewHistory({
          status: "success",
          operation: "create_pole_or_transformer",
          parameters: this.history.getParams(param),
          result: {
            "id": createdProductType.id.toString(),
            "name": createdProductType.name,
            "createAt": createdProductType.createAt.toString(),
            "recordStatus": createdProductType.recordStatus.toString(),
            "type": createdProductType.type.toString()

          }
        }, param.req.user.username,param.sessionId)

        return {
          continuePrompt: undefined,
          toolName: "create_pole_or_transformer"
        }
      }
    })

    this.toolRegister.register({
      functionName: "update_pole_or_transformer",
      handler: async (param: any): Promise<RequestResult> => {
        if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_pole_or_transformer",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.poletrafo.nameisrequired
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.poletrafo.nameisrequired, HttpStatus.BAD_REQUEST);
        }

        const productTypeDto = new UpdateProductTypeDto();
        productTypeDto.name = this.toolRegister.normalizingName(param.name);

        const updateId = await this.productTypeRepository.findByName(param.name);

        if (updateId == null) {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_pole_or_transformer",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.poletrafo.notfound
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.poletrafo.notfound, HttpStatus.BAD_REQUEST);

        }
        productTypeDto.id = updateId.id;
        productTypeDto.type=param.type?this.extractProductType(this.toolRegister.normalizingName(param.type)):updateId.type;


        var productType = await this.getById(productTypeDto.id);
        if (!productType) {
          throw new HttpException("The ProductType is not found!", HttpStatus.NOT_FOUND);
        }

        productType.name = param.newname ?? productType.name;
        productType.type = productTypeDto.type ?? productType.type;

        const updatedProductType = await this.update(productType);
        this.history.addNewHistory({
          status: "success",
          operation: "update_pole_or_transformer",
          parameters: this.history.getParams(param),
          result: {
            "id": updatedProductType.id.toString(),
            "name": param.newName,
            "type": updatedProductType.type.toString(),
          }
        }, param.req.user.username,param.sessionId)

        return {
          continuePrompt: undefined,
          toolName: "update_pole_or_transformer"
        }

      }
    })
    this.toolRegister.register({
      functionName: "delete_pole_or_transformer",
      handler: async (param: any): Promise<RequestResult> => {

        if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "delete_pole_or_transformer",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.nameisrequired
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.product.nameisrequired, HttpStatus.BAD_REQUEST);
        }


        const deleteProductname = this.toolRegister.normalizingName(param.name);


        var deleteId = await this.productTypeRepository.findByName(deleteProductname);
        if (deleteId==null) {
          this.history.addNewHistory({
            status: "fault",
            operation: "delete_pole_or_transformer",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.productnotfound
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.product.productnotfound, HttpStatus.NOT_FOUND);
        }

        var deleteProduct = await this.delete(deleteId.id);
        this.history.addNewHistory({
          status: "success",
          operation: "delete_pole_or_transformer",
          parameters: this.history.getParams(param),
          result: {
            "id": deleteId.id.toString(),
            "name": deleteProductname,
          }
        }, param.req.user.username,param.sessionId)


        return {
          continuePrompt: undefined,
          toolName: "delete_pole_or_transformer"
        };
      }
    })

    this.toolRegister.register({
      functionName: "update_pole_or_transformer_record_status",
      handler: async (param: any): Promise<RequestResult> => {
              if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_pole_or_transformer_record_status",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.poletrafo.nameisrequired
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.poletrafo.nameisrequired, HttpStatus.BAD_REQUEST);
        }

        const updateName=this.toolRegister.normalizingName(param.name)
        const updateId = await this.productTypeRepository.findByName(updateName);

        if (updateId == null) {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_pole_or_transformer_record_status",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.poletrafo.notfound
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.poletrafo.notfound, HttpStatus.BAD_REQUEST);

        }
        updateId.recordStatus = param.recordStatus ?? updateId.recordStatus;

        const updatedProductType = await this.update(updateId);
        this.history.addNewHistory({
          status: "success",
          operation: "update_pole_or_transformer_record_status",
          parameters: this.history.getParams(param),
          result: {
            "id": updatedProductType.id.toString(),
            "name": param.name,
            "recordstatus": updatedProductType.recordStatus.toString(),
          }
        }, param.req.user.username,param.sessionId)

        return {
          continuePrompt: undefined,
          toolName: "update_pole_or_transformer_record_status"
        }
      }
    })

  }

  extractProductType(type: string): ProductType {
    switch (type.toLocaleLowerCase().replaceAll(" ", "")) {
      case "ahani":
        return ProductType.Dr1
      case "beton":
        return ProductType.Dr2
      case "transformer":
        return ProductType.Tf
      case "dr1":
        return ProductType.Dr1
      case "dr2":
        return ProductType.Dr2
      case "trafo":
        return ProductType.Tf
      default:
        return ProductType.Tf
    }
  }



}