import normalizeIds from '../../utils/normalizeIds';
import QueryBuilderOperation from '../../queryBuilder/operations/QueryBuilderOperation';

export default class BelongsToOneRelateOperation extends QueryBuilderOperation {

  constructor(builder, name, opt) {
    super(builder, name, opt);

    this.isWriteOperation = true;
    this.relation = opt.relation;
    this.owner = opt.owner;
    this.input = null;
    this.ids = null;
  }

  call(builder, args) {
    this.input = args[0];
    this.ids = normalizeIds(args[0], this.relation.relatedProp, {arrayOutput: true});

    if (this.ids.length > 1) {
      this.relation.throwError('can only relate one model to a BelongsToOneRelation');
    }

    return true;
  }

  queryExecutor(builder) {
    let patch = {};

    for (let i = 0, l = this.relation.ownerProp.length; i < l; ++i) {
      const prop = this.relation.ownerProp[i];

      this.owner[prop] = this.ids[0][i];
      patch[prop] = this.ids[0][i];
    }

    return this.relation.ownerModelClass
      .query()
      .childQueryOf(builder)
      .copyFrom(builder, /where/i)
      .patch(patch)
      .whereComposite(this.relation.ownerModelClass.getFullIdColumn(), this.owner.$id());
  }

  onAfterInternal(builder) {
    return this.input;
  }
}
