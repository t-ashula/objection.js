import Relation from '../Relation';

import BelongsToOneInsertOperation from './BelongsToOneInsertOperation';
import BelongsToOneRelateOperation from './BelongsToOneRelateOperation';
import BelongsToOneUnrelateOperation from './BelongsToOneUnrelateOperation';

export default class BelongsToOneRelation extends Relation {

  createRelationProp(owners, related) {
    const relatedByOwnerId = Object.create(null);

    for (let i = 0, l = related.length; i < l; ++i) {
      const rel = related[i];
      const key = rel.$propKey(this.relatedProp);

      relatedByOwnerId[key] = rel;
    }

    for (let i = 0, l = owners.length; i < l; ++i) {
      const own = owners[i];
      const key = own.$propKey(this.ownerProp);

      own[this.name] = relatedByOwnerId[key] || null;
    }
  }

  insert(builder, owner) {
    return new BelongsToOneInsertOperation(builder, 'insert', {
      relation: this,
      owner: owner
    });
  }

  relate(builder, owner) {
    return new BelongsToOneRelateOperation(builder, 'relate', {
      relation: this,
      owner: owner
    });
  }

  unrelate(builder, owner) {
    return new BelongsToOneUnrelateOperation(builder, 'unrelate', {
      relation: this,
      owner: owner
    });
  }
}