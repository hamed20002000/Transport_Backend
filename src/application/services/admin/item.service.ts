import { forwardRef, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { SystemOperations } from 'src/domain/entities/SystemOperations';
import { SystemOperationRepository } from 'src/infrastructure/repositories/admin/system-operation.repository';
import { ItemUnits } from 'src/domain/entities/ItemUnits';
import { ItemUnitRepository } from 'src/infrastructure/repositories/admin/item-unit.repository';
import { Items } from 'src/domain/entities/Items';
import { ItemRepository } from 'src/infrastructure/repositories/admin/item.repository';
import { ContextManager } from '../agent/contextManager';
import { ToolRegister } from '../agent/toolRegister';
import { UserService } from '../user/user.service';
import { RequestResult } from '../agent/types';
import { UsernameSpecification } from 'src/application/specifications/user/user-specifications';
import { ItemAbbriviationSpecification, ItemCreateCheckAbbSpecification, ItemIdSpecification, ItemSpecification } from 'src/application/specifications/admin/item-specifications';
import messages from '../agent/localFiles/messages.json'
import { CreateItemUnitDto } from 'src/presentation/dtos/baseinfo/item-unit.dto';
import { CreateItemDto, ItemListDto, UpdateItemDto } from 'src/presentation/dtos/baseinfo/item.dto';
import { GenericMapper } from 'src/presentation/helpers/mapper-classes';
import { Categories } from 'src/domain/entities/Categories';
import { CategorySpecification } from 'src/application/specifications/admin/category-specifications';
import { CategoryService } from './category.service';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { ItemUnitService } from './item-unit.service';
import { ItemUnitSpecification } from 'src/application/specifications/admin/item-unit-specifications';

@Injectable()
export class ItemService extends BaseService<Items> {
  constructor(

    private readonly itemRepository: ItemRepository,
    private readonly history: ContextManager,
    private readonly toolRegister: ToolRegister,
    private readonly categoryService:CategoryService,
    private readonly unitItemService:ItemUnitService,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
  ) {
    super(itemRepository);
  }

  onModuleInit() {
    this.toolRegister.register({
      functionName: "create_product",
      handler: async (param: any): Promise<RequestResult> => {

           if (param.productname == undefined || param.productname.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "create_product",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.nameisrequired
            }
          }, param.req.user.username)
          throw new HttpException(messages.product.nameisrequired, HttpStatus.BAD_REQUEST);
        }

           if(param.categoryname==""||param.categoryname==undefined){
           this.history.addNewHistory({
            status: "fault",
            operation: "create_product",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.categorynamerequired
            }
          }, param.req.user.username)
          throw new HttpException( messages.product.categorynamerequired, HttpStatus.BAD_REQUEST);
        }

              if(param.unitname==""||param.unitname==undefined){
           this.history.addNewHistory({
            status: "fault",
            operation: "create_product",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.unitnamerequired
            }
          }, param.req.user.username)
          throw new HttpException( messages.product.unitnamerequired, HttpStatus.BAD_REQUEST);
        }




              var specification = new ItemSpecification(this.toolRegister.normalizingName(param.productname).trim());
        var check = await this.getWithSpecification(specification);
        if (check.length > 0) {
           this.history.addNewHistory({
            status: "fault",
            operation: "create_product",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.productalreadyexist
            }
          }, param.req.user.username)
          throw new HttpException( messages.product.productalreadyexist, HttpStatus.BAD_REQUEST);
        }





        var user = param.req.user;
        const user_specification = new UsernameSpecification(user.username);
        var checkUser = await this.userService.getWithSpecification(user_specification, null,
          {
            id: true

          });
            var  itemDto=new CreateItemDto();
            itemDto.name=this.toolRegister.normalizingName(param.productname);
            itemDto.abbreviation=param.abbreviation
            itemDto.weight=param.weight;
            itemDto.description=param.description;
            itemDto.code=param.code;
            var categoryName=param.categoryname;
            var unitName=param.unitname;
            
  
        if (itemDto.abbreviation != null && itemDto.abbreviation != undefined) {
          var abb_specification = new ItemCreateCheckAbbSpecification(itemDto.abbreviation.trim());
          var checkAbb = await this.getWithSpecification(abb_specification);
          if (checkAbb.length > 0) {
             this.history.addNewHistory({
            status: "fault",
            operation: "create_product",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.abbriviationalreadyexist
            }
          }, param.req.user.username)
            throw new HttpException(messages.product.abbriviationalreadyexist, HttpStatus.BAD_REQUEST);
          }
        }
        var item = GenericMapper.toEntity(Items, itemDto);
        item.name = this.toolRegister.normalizingName(itemDto.name).trim();

     

         var categoryspecification = new CategorySpecification(categoryName.trim());
        var categorycheck = await this.categoryService.getWithSpecification(categoryspecification);
        if (categorycheck.length<1) {
           this.history.addNewHistory({
            status: "fault",
            operation: "create_product",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.category.categorynotfound
            }
          }, param.req.user.username)
          throw new HttpException( messages.product.categorynotfound, HttpStatus.BAD_REQUEST);
        }
   

         var unitspecification = new ItemUnitSpecification(unitName.trim());
        var itemUnitCheck = await this.unitItemService.getWithSpecification(unitspecification);
        if (categorycheck.length<1) {
           this.history.addNewHistory({
            status: "fault",
            operation: "create_product",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.unititemunitfound
            }
          }, param.req.user.username)
          throw new HttpException( messages.product.unititemunitfound, HttpStatus.BAD_REQUEST);
        }

        item.category = new Categories();
        item.category.id = categorycheck[0].id;
        item.unit = new ItemUnits();
        item.unit.id = itemUnitCheck[0].id;
        item.weghit = itemDto.weight;
        item.createAt = new Date();
        item.recordStatus = recordStatus.Active;
        item.description=itemDto.description;
        item.user = checkUser[0];

        var createdProduct = await this.add(item);

        this.history.addNewHistory({
          status: "success",
          operation: "create_product",
          parameters: this.history.getParams(param),
          result: {
            "id": createdProduct.id.toString(),
            "name": createdProduct.name,
            "createAt": createdProduct.createAt.toString(),
            "recordStatus": createdProduct.recordStatus.toString(),
            "weight":createdProduct.weghit?.toString(),
            "unitName":unitName,
            "categoryName":categoryName
          }
        }, param.req.user.username)

        return {
          continuePrompt: undefined,
          toolName: "create_product"
        }
      }
    })

    this.toolRegister.register({
      functionName: "update_product",
      handler: async (param: any): Promise<RequestResult> => {
        if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_product",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.nameisrequired
            }
          }, param.req.user.username)
          throw new HttpException(messages.product.nameisrequired, HttpStatus.BAD_REQUEST);
        }

        var updateDto = new UpdateItemDto();
        updateDto.newName = param.newname
        updateDto.recordStatus = param.recordStatus
        updateDto.abbreviation=param.abbreviation
        updateDto.code=param.code
        updateDto.description=param.description
        updateDto.weight=param.weight
        

        var unitName=param.unitname
        var categoryname=param.categoryname


        var specification = new ItemSpecification(param.name);
        var checkProduct = await this.getWithSpecification(specification);

        if (checkProduct.length < 1) {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_product",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.productnotfound
            }
          }, param.req.user.username)
          throw new HttpException(messages.product.productnotfound, HttpStatus.NOT_FOUND);
        }

        
                if (updateDto.abbreviation != null && updateDto.abbreviation != undefined) {
                    var abbSpecification = new ItemAbbriviationSpecification(updateDto.abbreviation.trim(), updateDto.id);
                    var check = await this.getWithSpecification(abbSpecification);
                    if (check.length > 0) {
                      this.history.addNewHistory({
            status: "fault",
            operation: "update_product",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.abbriviationalreadyexist
            }
          }, param.req.user.username)
                        throw new HttpException(messages.product.abbriviationalreadyexist, HttpStatus.BAD_REQUEST);
                    }
                }
                checkProduct[0].abbreviation = updateDto.abbreviation ?? checkProduct[0].abbreviation;


                if(unitName!=""&&unitName!=undefined){
                            var unitspecification = new ItemUnitSpecification(unitName.trim());
                      var itemUnitCheck = await this.unitItemService.getWithSpecification(unitspecification);
                      if (itemUnitCheck.length<1) {
                        this.history.addNewHistory({
                          status: "fault",
                          operation: "update_product",
                          parameters: this.history.getParams(param),
                          result: {
                            errorMessage: messages.product.unititemunitfound
                          }
                        }, param.req.user.username)
                        throw new HttpException( messages.product.unititemunitfound, HttpStatus.BAD_REQUEST);
                      }
                        
                    checkProduct[0].unit = new ItemUnits();
                    checkProduct[0].unit.id = updateDto.itemUnitId;
                
                }


                if(categoryname!=""&&categoryname!=undefined){
                            var categoryspecification = new CategorySpecification(categoryname.trim());
                      var itemUnitCheck = await this.unitItemService.getWithSpecification(unitspecification);
                      if (itemUnitCheck.length<1) {
                        this.history.addNewHistory({
                          status: "fault",
                          operation: "update_product",
                          parameters: this.history.getParams(param),
                          result: {
                            errorMessage: messages.product.categorynotfound
                          }
                        }, param.req.user.username)
                        throw new HttpException( messages.product.categorynotfound, HttpStatus.BAD_REQUEST);
                      }
                        
                    
                    checkProduct[0].category = new Categories();
                    checkProduct[0].category.id = updateDto.categoryId;
                
                }
                updateDto.id=checkProduct[0].id;

        
                checkProduct[0].name = updateDto.newName?.trim() ?? checkProduct[0].name;
                checkProduct[0].code = updateDto.code ?? checkProduct[0].code;
                checkProduct[0].weghit = updateDto.weight ?? checkProduct[0].weghit;
                checkProduct[0].description = updateDto.description ?? checkProduct[0].description;
              
        
                var updateItme = await this.update(checkProduct[0]);
                checkProduct = await this.getWithSpecification(
                    specification,
                    null,
                    null,
                    { category: true, unit: true }
                );
                var result = GenericMapper.toDto(ItemListDto, updateItme, { excludeExtraneousValues: true });
        
        
                result.category = checkProduct[0]?.category;
                result.unit = checkProduct[0]?.unit;
              this.history.addNewHistory({
          status: "success",
          operation: "update_product",
          parameters: this.history.getParams(param),
          result: {
            "id": updateDto.id.toString(),
            "name": updateDto.newName,
            "abbreviation": updateDto.abbreviation?.toString(),
            "code": updateDto.code?.toString(),
            "description": updateDto.description?.toString(),
            "weight": updateDto.weight?.toString(),
          }
        }, param.req.user.username)

        return {
          continuePrompt: undefined,
          toolName: "update_product"
        }

      }
    })


    this.toolRegister.register({
      functionName: "delete_product",
      handler: async (param: any): Promise<RequestResult> => {

        if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "delete_product",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.nameisrequired
            }
          }, param.req.user.username)
          throw new HttpException(messages.product.nameisrequired, HttpStatus.BAD_REQUEST);
        }


        const deleteProductname = this.toolRegister.normalizingName(param.name);


        var specification = new ItemSpecification(deleteProductname);
        var checkProduct = await this.getWithSpecification(specification);
        if (checkProduct.length < 1) {
          this.history.addNewHistory({
            status: "fault",
            operation: "delete_product",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.productnotfound
            }
          }, param.req.user.username)
          throw new HttpException(messages.product.productnotfound, HttpStatus.NOT_FOUND);
        }

        var deleteProduct = await this.delete(checkProduct[0].id);
        this.history.addNewHistory({
          status: "success",
          operation: "delete_product",
          parameters: this.history.getParams(param),
          result: {
            "id": checkProduct[0].id.toString(),
            "name": deleteProductname,
          }
        }, param.req.user.username)


        return {
          continuePrompt: undefined,
          toolName: "delete_product"
        };
      }
    })

    this.toolRegister.register({
      functionName: "update_product_record_status",
      handler: async (param: any): Promise<RequestResult> => {
    if (param.name == undefined || param.name.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_product_record_status",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.nameisrequired
            }
          }, param.req.user.username)
          throw new HttpException(messages.product.nameisrequired, HttpStatus.BAD_REQUEST);
        }

        var updateDto = new UpdateItemDto();
        updateDto.recordStatus = param.recordstatus
   
        


        var specification = new ItemSpecification(param.name);
        var checkProduct = await this.getWithSpecification(specification);

        if (checkProduct.length < 1) {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_product_record_status",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.product.productnotfound
            }
          }, param.req.user.username)
          throw new HttpException(messages.product.productnotfound, HttpStatus.NOT_FOUND);
        }

        


           
                updateDto.id=checkProduct[0].id;

        
                checkProduct[0].recordStatus = updateDto.recordStatus ?? checkProduct[0].recordStatus;
              
        
                var updateItme = await this.update(checkProduct[0]);
                checkProduct = await this.getWithSpecification(
                    specification,
                    null,
                    null,
                    { category: true, unit: true }
                );
                var result = GenericMapper.toDto(ItemListDto, updateItme, { excludeExtraneousValues: true });
        
        
                result.category = checkProduct[0]?.category;
                result.unit = checkProduct[0]?.unit;
              this.history.addNewHistory({
          status: "success",
          operation: "update_product_record_status",
          parameters: this.history.getParams(param),
          result: {
            "id": updateDto.id.toString(),
            "recordstatus":updateDto.recordStatus.toString()
          }
        }, param.req.user.username)

        return {
          continuePrompt: undefined,
          toolName: "update_product_record_status"
        }
      }
    })



  }


}