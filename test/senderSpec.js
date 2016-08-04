'use strict'

const chai = require('chai')
const sinon = require('sinon')
const sinonChai = require('sinon-chai')
require('sinon-as-promised')
chai.use(sinonChai)
const chaiAsPromised = require('chai-as-promised')
chai.use(chaiAsPromised)
const expect = chai.expect
const timekeeper = require('timekeeper')
const _ = require('lodash')
const mockRequire = require('mock-require')

const createSender = require('../src/lib/sender').createSender
const MockClient = require('./mocks/mockCore').Client
const paymentRequest = require('./data/paymentRequest.json')
const paymentParams = require('./data/paymentParams.json')

describe('Sender Module', function () {
  beforeEach(function () {
    this.client = new MockClient({})
    timekeeper.freeze(new Date(0))
  })

  afterEach(function () {
    timekeeper.reset()
  })

  describe('createSender', function () {
    it('should return an object with the `quoteRequest` and `payRequest` functions', function () {
      const sender = createSender({
        client: this.client
      })
      expect(sender).to.be.a('object')
      expect(sender.quoteRequest).to.be.a('function')
      expect(sender.payRequest).to.be.a('function')
    })

    it('should instantiate a new ilp-core Client if one is not supplied', function () {
      const stub = sinon.stub().returns({})
      mockRequire('ilp-core', {
        Client: stub
      })
      const createSenderWithMock = mockRequire.reRequire('../src/lib/sender').createSender
      createSenderWithMock({
        hmacKey: Buffer.from('+Xd3hhabpygJD6cen+R/eon+acKWvFLzqp65XieY8W0=', 'base64')
      })
      expect(stub).to.have.been.calledOnce
      mockRequire.stop('ilp-core')
    })
  })

  describe('Sender', function () {
    beforeEach(function () {
      this.paymentParams = _.cloneDeep(paymentParams)
      this.sender = createSender({
        client: this.client
      })
    })

    describe('quoteRequest', function () {
      beforeEach(function () {
        this.paymentRequest = _.cloneDeep(paymentRequest)
        this.quoteStub = sinon.stub(this.client, 'quote')
        this.quoteStub.withArgs({
          destinationLedger: 'https://blue.ilpdemo.org/ledger',
          destinationAmount: '1'
        }).resolves({
          connectorAccount: 'https://blue.ilpdemo.org/ledger/accounts/connie',
          sourceAmount: '2'
        })
      })

      afterEach(function () {
        this.quoteStub.restore()
      })

      it.skip('should reject if the hold time is greater than the maxHoldDuration', function () {

      })

      it('should reject if there is no execution condition', function (done) {
        expect(this.sender.quoteRequest(_.assign(this.paymentRequest, {
          data: {
            execution_condition: null
          }
        }))).to.be.rejectedWith('Payment requests must have execution conditions').notify(done)
      })

      it('should accept a payment request generated by the Receiver', function * () {
        const result = yield this.sender.quoteRequest(this.paymentRequest)
        expect(result).to.be.ok
        expect(this.quoteStub).to.have.been.calledOnce
      })

      it('should resolve to valid parameters for payRequest', function * () {
        const result = yield this.sender.quoteRequest(this.paymentRequest)
        expect(result).to.deep.equal(this.paymentParams)
      })
    })

    describe('payRequest', function () {
      it('should accept the output of quoteRequest', function * () {
        const stub = sinon.stub(this.client, 'sendQuotedPayment')
        stub.resolves(new Promise((resolve) => {
          setImmediate(() => this.client.emit('fulfill_execution_condition', {
            executionCondition: this.paymentParams.executionCondition
          }, 'fulfillment'))
          resolve()
        }))
        const result = yield this.sender.payRequest(this.paymentParams)
        expect(result).to.be.ok
        expect(stub).to.have.been.calledWith({
          'connectorAccount': 'https://blue.ilpdemo.org/ledger/accounts/connie',
          'destinationAccount': 'https://blue.ilpdemo.org/ledger/accounts/bob',
          'destinationLedger': 'https://blue.ilpdemo.org/ledger',
          'sourceAmount': '2',
          'destinationAmount': '1',
          'destinationMemo': {
            'request_id': '22e315dc-3f99-4f89-9914-1987ceaa906d',
            'expires_at': '1970-01-01T00:00:10Z'
          },
          'executionCondition': 'cc:0:3:4l2SBwP_i-oCEzaD2IGRpwdywCfaBmrxJcpJ_3PXv6o:32',
          'expiresAt': '1970-01-01T00:00:10.000Z'
        })
      })

      it('should resolve to the transfer\'s condition fulfillment', function * () {
        const stub = sinon.stub(this.client, 'sendQuotedPayment')
        stub.resolves(new Promise((resolve) => {
          setImmediate(() => this.client.emit('fulfill_execution_condition', {
            executionCondition: this.paymentParams.executionCondition
          }, 'fulfillment'))
          resolve()
        }))
        const fulfillment = yield this.sender.payRequest(this.paymentParams)
        expect(fulfillment).to.equal('fulfillment')
        expect(stub).to.be.calledOnce
      })

      it('should reject if the transfer times out', function * () {
        timekeeper.reset()
        const clock = sinon.useFakeTimers(0)
        const stub = sinon.stub(this.client, 'sendQuotedPayment')
        stub.resolves(Promise.resolve().then(() => {
          setImmediate(() => clock.tick(10000))
        }))
        // clock is restored before end because of https://github.com/sinonjs/sinon/issues/738
        clock.restore()
        try {
          yield this.sender.payRequest(this.paymentParams)
        } catch (e) {
          expect(e.message).to.equal('Transfer expired, money returned')
        }
      })

      it('should resolve only when the transfer with the right condition is fulfilled', function * () {
        const stub = sinon.stub(this.client, 'sendQuotedPayment')
        stub.resolves(new Promise((resolve) => {
          setImmediate(() => {
            return this.client.emitAsync('fulfill_execution_condition', {
              executionCondition: 'some-other-condition'
            }, 'not-the-right-fulfillment')
            .then(() => {
              return this.client.emitAsync('fulfill_execution_condition', {
                executionCondition: this.paymentParams.executionCondition
              }, 'correct-fulfillment')
            })
          })
          resolve()
        }))
        const fulfillment = yield this.sender.payRequest(this.paymentParams)
        expect(fulfillment).to.equal('correct-fulfillment')
        expect(stub).to.be.calledOnce
      })
    })
  })
})