'use strict';

var _ = require('lodash');
var utils = require('../../lib/utils/dbUtils');
var expect = require('expect.js');
var Promise = require('bluebird');
var transaction = require('../../').transaction;
var ValidationError = require('../../').ValidationError;
var inheritModel = require('../../lib/model/inheritModel');

module.exports = function (session) {
  var Model1 = session.models.Model1;
  var Model2 = session.models.Model2;

  describe('Model insertGraph queries', function () {
    var population;
    var insertion;
    var eagerExpr = '[model1Relation1.model1Relation3, model1Relation1Inverse, model1Relation2]';

    beforeEach(function () {
      population = {
        id: 1,
        model1Prop1: '20',
        model1Relation3: [{
          idCol: 1
        }]
      };

      insertion = {
        model1Prop1: 'root',

        model1Relation1: {
          model1Prop1: 'parent',
          model1Prop2: '#ref{grandChild.idCol}',

          model1Relation3: [{
            "#ref": 'child1'
          }, {
            "#id": 'grandChild',
            model2Prop1: 'cibling2',
            // These should go to the join table.
            extra1: 'extraVal1',
            extra2: 'extraVal2'
          }, {
            "#dbRef": 1,
            extra1: 'foo'
          }]
        },

        model1Relation1Inverse: {
          model1Prop1: 'rootParent'
        },

        model1Relation2: [{
          "#id": 'child1',
          model2Prop1: 'child1'
        }, {
          model2Prop1: 'child2'
        }]
      };
    });

    describe('.query().insertGraph()', function () {

      beforeEach(function () {
        return session.populate(population);
      });

      it('should insert a model with relations', function () {
        return Model1
          .query()
          .insertGraph(insertion)
          .then(function (inserted) {
            return check(inserted, true).return(inserted);
          })
          .then(function (inserted) {
            expect(inserted).to.not.have.property('model1Prop2');
            return Model1.query().eager(eagerExpr).where('id', inserted.id).first();
          })
          .then(function (model) {
            return check(model);
          });
      });

      it('should create #dbRef references to existing rows', function () {
        return Model1
          .query()
          .insertGraph(insertion)
          .then(function () {
            return session.knex('Model1Model2');
          })
          .then(function (rows) {
            rows = _.map(_.sortBy(rows, ['model1Id', 'model2Id']), function (row) {
              return _.pick(row, 'model1Id', 'model2Id', 'extra1');
            });

            expect(rows).to.eql([
              { model1Id: 1, model2Id: 1, extra1: null },
              { model1Id: 2, model2Id: 1, extra1: 'foo' },
              { model1Id: 2, model2Id: 2, extra1: 'extraVal1'},
              { model1Id: 2, model2Id: 3, extra1: null }
            ]);
          });
      });

      it('should have alias `insertWithRelated`', function () {
        return Model1
          .query()
          .insertWithRelated(insertion)
          .then(function (inserted) {
            return check(inserted, true).return(inserted);
          })
          .then(function (inserted) {
            expect(inserted).to.not.have.property('model1Prop2');
            return Model1.query().eager(eagerExpr).where('id', inserted.id).first();
          })
          .then(function (model) {
            return check(model);
          });
      });

      describe('jsonSchema: additionalProperties = false', function () {
        var origSchema;

        before(function () {
          origSchema = Model1.jsonSchema;
          Model1.jsonSchema = {
            type: 'object',
            additionalProperties: false,
            properties: {
              model1Prop1: {type: 'string'},
              model1Prop2: {type: 'number'},
              model1Id: {type: 'number'}
            }
          }
        });

        after(function () {
          Model1.jsonSchema = origSchema;
        });

        it('should insert a model with relations', function () {
          return Model1
            .query()
            .insertGraph(insertion)
            .then(function (inserted) {
              return check(inserted, true).return(inserted);
            })
            .then(function (inserted) {
              expect(inserted).to.not.have.property('model1Prop2');
              return Model1.query().eager(eagerExpr).where('id', inserted.id).first();
            })
            .then(function (model) {
              return check(model);
            });
        });

      });

      it('should accept raw sql and subqueries', function () {
        return Model1
          .query()
          .insertGraph([{
            model1Prop1: '10'
          }, {
            model1Prop1: '50'
          }])
          .then(function () {
            return Model1
              .query()
              .insertGraph({
                model1Prop1: Model1.raw("40 + 2"),

                model1Relation2: [{
                  "#id": 'child1',
                  idCol: 100,
                  model2Prop1: Model1.query().min('model1Prop1')
                }, {
                  idCol: 101,
                  model2Prop1: Model1.knex().from('Model1').max('model1Prop1')
                }]
              });
          })
          .then(function (inserted) {
            inserted.model1Relation2 = _.sortBy(inserted.model1Relation2, 'idCol');

            expect(inserted.toJSON()).to.eql({
              id: 4,
              model1Relation2: [
                { model1Id: 4, idCol: 100 },
                { model1Id: 4, idCol: 101 }
              ]
            });

            return Model1.query().eager('model1Relation2').where('id', inserted.id);
          })
          .then(function (inserted) {
            inserted[0].model1Relation2 = _.sortBy(inserted[0].model1Relation2, 'idCol');

            expect(inserted[0]).to.eql({
              id: 4,
              model1Id: null,
              model1Prop1: '42',
              model1Prop2: null,
              $afterGetCalled: 1,
              model1Relation2: [
                { idCol: 100, model1Id: 4, model2Prop1: '10', model2Prop2: null, $afterGetCalled: 1},
                { idCol: 101, model1Id: 4, model2Prop1: '50', model2Prop2: null, $afterGetCalled: 1}
              ]
            });
          });
      });

      it('should validate models upon insertion', function (done) {
        insertion.model1Relation1.model1Prop1 = 666;

        return transaction(Model1, Model2, function (Model1, Model2) {
          // We can modify Model1 and Model2 here since it is a subclass of the actual
          // models shared between tests.
          Model1.jsonSchema = {
            type: 'object',
            properties: {
              id: {type: 'integer'},
              model1Id: {type: 'integer'},
              model1Prop1: {type: 'string'},
              model1Prop2: {type: 'integer'}
            }
          };

          Model2.jsonSchema = {
            type: 'object',
            properties: {
              idCol: {type: 'integer'},
              model1Id: {type: 'integer'},
              model2Prop1: {type: 'string'},
              model2Prop2: {type: 'integer'}
            }
          };

          // Clear the memoized schema.
          Model1.$$hiddenData.memoizedGetJsonSchema = undefined;
          Model2.$$hiddenData.memoizedGetJsonSchema = undefined;

          expect(Model1.getJsonSchema()).to.equal(Model1.jsonSchema);
          expect(Model2.getJsonSchema()).to.equal(Model2.jsonSchema);

          return Model1.query().insertGraph(insertion);
        }).then(function () {
          done(new Error('should not get here'));
        }).catch(function (err) {
          expect(err).to.be.a(ValidationError);
          expect(err.data).to.have.property('model1Prop1');

          return Promise.all([
            session.knex('Model1'),
            session.knex('model_2')
          ]);
        }).spread(function (rows1, rows2) {
          expect(rows1).to.have.length(1);
          expect(rows2).to.have.length(1);
          done();
        }).catch(done);
      });

      it('should validate models upon insertion: references in integer columns should be accepted', function () {
        return transaction(Model1, Model2, function (Model1, Model2) {
          // We can modify Model1 and Model2 here since it is a subclass of the actual
          // models shared between tests.
          Model1.jsonSchema = {
            type: 'object',
            properties: {
              id: {type: 'integer'},
              model1Id: {type: 'integer'},
              model1Prop1: {type: 'string'},
              model1Prop2: {type: 'integer'}
            }
          };

          Model2.jsonSchema = {
            type: 'object',
            properties: {
              idCol: {type: 'integer'},
              model1Id: {type: 'integer'},
              model2Prop1: {type: 'string'},
              model2Prop2: {type: 'integer'}
            }
          };

          // Clear the memoized schema.
          Model1.$$hiddenData.memoizedGetJsonSchema = undefined;
          Model2.$$hiddenData.memoizedGetJsonSchema = undefined;

          expect(Model1.getJsonSchema()).to.equal(Model1.jsonSchema);
          expect(Model2.getJsonSchema()).to.equal(Model2.jsonSchema);

          return Model1
            .query()
            .insertGraph(insertion)
            .then(function (inserted) {
              return check(inserted, true).return(inserted);
            })
            .then(function (inserted) {
              expect(inserted).to.not.have.property('model1Prop2');
              return Model1.query().eager(eagerExpr).where('id', inserted.id).first();
            })
            .then(function (model) {
              return check(model);
            });
        });
      });

      if (utils.isPostgres(session.knex)) {
        it('query building methods should be applied to the root models', function () {
          return Model1
            .query()
            .insertGraph(insertion)
            .returning('*')
            .then(function (inserted) {
              return check(inserted, true).return(inserted);
            })
            .then(function (inserted) {
              expect(inserted).to.have.property('model1Prop2');
              return Model1.query().eager(eagerExpr).where('id', inserted.id).first();
            })
            .then(function (model) {
              return check(model);
            });
        });
      }

    });

    describe('.query().insertGraphAndFetch()', function () {

      beforeEach(function () {
        return session.populate(population);
      });

      it('should insert a model with relations and fetch the inserted graph', function () {
        return Model1
          .query()
          .insertGraphAndFetch(insertion)
          .then(function (inserted) {
            return Model1.query().eager(eagerExpr).where('id', inserted.id).first().then(function (fetched) {
              expect(inserted.$toJson()).to.eql(fetched.$toJson());
            });
          });
      });

    });

    describe('.query().insertGraph().allowRelated()', function () {

      beforeEach(function () {
        return session.populate(population);
      });

      it('should allow insert when the allowed relation expression is a superset', function () {
        return Model1
          .query()
          .insertGraph(insertion)
          .allowInsert(eagerExpr)
          .then(function (inserted) {
            return check(inserted, true).return(inserted);
          });
      });

      it('should not allow insert when the allowed relation expression is not a superset', function (done) {
        return Model1
          .query()
          .insertGraph(insertion)
          .allowInsert('[model1Relation1.model1Relation3, model1Relation2]')
          .then(function () {
            done(new Error('should not get here'));
          })
          .catch(function (err) {
            expect(err instanceof ValidationError).to.equal(true);
            done();
          })
          .catch(done);
      });

    });

    describe('.$query().insertGraph()', function () {

      beforeEach(function () {
        return session.populate(population);
      });

      it('should insert a model with relations', function () {
        return Model1
          .fromJson(insertion)
          .$query()
          .insertGraph()
          .then(function (inserted) {
            return check(inserted, true).return(inserted);
          })
          .then(function (inserted) {
            return Model1.query().eager(eagerExpr).where('id', inserted.id).first();
          })
          .then(function (model) {
            return check(model);
          });
      });

    });

    describe('.$relatedQuery().insertGraph()', function () {

      describe('has many relation', function () {
        var parent;

        beforeEach(function () {
          return session.populate(population);
        });

        beforeEach(function () {
          return Model1
            .query()
            .where('id', 1)
            .first()
            .then(function (par) {
              parent = par;
            });
        });

        beforeEach(function () {
          insertion = {
            model2Prop1: 'howdy',
            model2Relation1: [insertion]
          };
        });

        it('should insert a model with relations', function () {
          return parent
            .$relatedQuery('model1Relation2')
            .insertGraph(insertion)
            .then(function (inserted) {
              return check(inserted.model2Relation1[0], true);
            })
            .then(function () {
              return parent
                .$relatedQuery('model1Relation2')
                .first();
            })
            .then(function (insertion) {
              expect(insertion.model2Prop1).to.equal('howdy');
              return insertion
                .$relatedQuery('model2Relation1')
                .eager(eagerExpr)
                .first();
            })
            .then(function (model) {
              return check(model);
            });
        });

      });

      describe('many to many relation', function () {
        var parent;

        beforeEach(function () {
          return session.populate(population);
        });

        beforeEach(function () {
          return Model1
            .query()
            .where('id', 1)
            .first()
            .then(function (par) {
              parent = par;
            });
        });

        beforeEach(function () {
          insertion = {
            model2Prop1: 'howdy',
            model2Relation1: [insertion]
          };
        });

        it('should insert a model with relations', function () {
          return parent
            .$relatedQuery('model1Relation3')
            .insertGraph(insertion)
            .then(function (inserted) {
              return check(inserted.model2Relation1[0], true);
            })
            .then(function () {
              return parent.$relatedQuery('model1Relation3');
            })
            .then(function (models) {
              var insertion = _.find(models, {model2Prop1: 'howdy'});
              return insertion
                .$relatedQuery('model2Relation1')
                .eager(eagerExpr);
            })
            .then(function (models) {
              var model = _.find(models, {model1Prop1: 'root'});
              return check(model);
            });
        });
      });

    });

    function check(model, shouldCheckHooks) {
      var knex = model.constructor.knex();

      expect(model).to.have.property('model1Relation1');
      expect(model.model1Relation1).to.have.property('model1Relation3');
      expect(model).to.have.property('model1Relation2');

      model.model1Relation1.model1Relation3 = _.sortBy(model.model1Relation1.model1Relation3, 'model2Prop1');
      model.model1Relation2 = _.sortBy(model.model1Relation2, 'model2Prop1');

      expect(model.model1Prop1).to.equal('root');
      shouldCheckHooks && checkHooks(model);

      expect(model.model1Relation1.model1Prop1).to.equal('parent');
      shouldCheckHooks && checkHooks(model.model1Relation1);

      expect(model.model1Relation1Inverse.model1Prop1).to.equal('rootParent');
      shouldCheckHooks && checkHooks(model.model1Relation1Inverse);

      expect(model.model1Relation1.model1Relation3[0].model2Prop1).to.equal('child1');
      shouldCheckHooks && checkHooks(model.model1Relation1.model1Relation3[0]);

      expect(model.model1Relation1.model1Relation3[1].model2Prop1).to.equal('cibling2');
      expect(model.model1Relation1.model1Relation3[1].extra1).to.equal('extraVal1');
      expect(model.model1Relation1.model1Relation3[1].extra2).to.equal('extraVal2');
      shouldCheckHooks && checkHooks(model.model1Relation1.model1Relation3[1]);

      expect(model.model1Relation2[0].model2Prop1).to.equal('child1');
      shouldCheckHooks && checkHooks(model.model1Relation2[0]);

      expect(model.model1Relation2[1].model2Prop1).to.equal('child2');
      shouldCheckHooks && checkHooks(model.model1Relation2[1]);

      return knex(Model2.tableName).then(function (rows) {
        // Check that the reference model was only inserted once.
        expect(_.filter(rows, {model_2_prop_1: 'child1'})).to.have.length(1);
      });
    }

    function checkHooks(model) {
      expect(model.$beforeInsertCalled).to.equal(1);
      expect(model.$afterInsertCalled).to.equal(1);
    }

  });
};
