/* global describe it beforeEach artifacts contract */

import { expect } from 'chai'
import { web3 } from './helpers/w3'
import moment from 'moment'
import lkTestHelpers from 'lk-test-helpers'
import tryAsync from './helpers/tryAsync'
import expectRevert from './helpers/expectRevert'
import { hasEvent } from './helpers/event'
import isNonZeroAddress from './helpers/isNonZeroAddress'

const { increaseTime, latestTime } = lkTestHelpers(web3)
const { accounts } = web3.eth

const cost = 100 // in BotCoin
const currentTime = 2
const duration = 1 // in weeks
const maxSubscriptionLength = 4 // in weeks
const payment = 100 // in BotCoin
const subscriber = accounts[1]
const nonSubscriber = accounts[2]
const wallet = '0x319f2c0d4e7583dff11a37ec4f2c907c8e76593a'

const BotCoin = artifacts.require('./BotCoin.sol')
const TokenSubscription = artifacts.require('./TokenSubscription.sol')

contract('TokenSubscription', () => {
  let tokenSubscription, walletAddress
  let botCoin

  beforeEach(async () => {
    botCoin = await newBotCoin();
    tokenSubscription = await newTokenSubscription(botCoin.address)
    walletAddress = await tokenSubscription.wallet.call()
  })

  describe('updateParameters()', () => {
    describe('when given valid parameters', () => {
      let txResult

      beforeEach(async () => {
        txResult = await tokenSubscription.updateParameters(cost, duration, maxSubscriptionLength)
      })

      it('should set the cost', async () => {
        expect((await tokenSubscription.cost.call()).toNumber()).to.equal(cost)
      })

      it('should set the duration', async () => {
        expect((await tokenSubscription.duration.call()).toNumber()).to.equal(duration)
      })

      it('should set the maxSubscriptionLength', async () => {
        expect((await tokenSubscription.maxSubscriptionLength.call()).toNumber()).to.equal(maxSubscriptionLength)
      })
    })
  })

  describe('extend()', () => {
    describe('when extending an existing subscriber', () => {
      let txResult

      beforeEach(async () => {
        // Setting up the contract to be in the right state
        const approvedPayment = 2 * payment
        await botCoin.transfer(subscriber, approvedPayment)
        await botCoin.approve(tokenSubscription.address, approvedPayment, { from: subscriber })
        await tokenSubscription.extend(payment, { from: subscriber })
        txResult = await tokenSubscription.extend(payment, { from: subscriber })
      })

      it('should extend existing subscriber subscription correctly', async () => {
        let endTime = (await tokenSubscription.subscriptionEndTimes.call(subscriber)).toNumber()
        const defaultTime = await defaultEndTime()
        expect(endTime).to.be.above(moment(defaultTime).add(24 * 7, 'hours').subtract(10, 'seconds').unix())
        expect(endTime).to.not.be.above(moment(defaultTime).add(24 * 7, 'hours').add(10, 'seconds').unix())
      })

      it('should require timeToExtend plus time remaining in the current subscription to be less than maxSubscriptionLength', async () => {
        const bigPayment = 5 * payment
        await expectRevert(tokenSubscription.extend.call(bigPayment, { from: subscriber}))
      })

      it('forwards funds correctly', async () => {
        // expect balance in wallet to increase by payment
        expect(await botcoinBalanceOf(botCoin, walletAddress)).to.equal(2 * payment)
      })
    })

    describe('when extending a new subscriber', () => {
      beforeEach(async () => {
        await botCoin.transfer(subscriber, payment)
        await botCoin.approve(tokenSubscription.address, payment, { from: subscriber })        
      })
     
      it('should set the subscription correctly', async () => {
        await tokenSubscription.extend(payment, { from: subscriber })
        let endTime = (await tokenSubscription.subscriptionEndTimes.call(subscriber)).toNumber()
        const validEndTime = await defaultEndTime()
        expect(endTime).to.be.above(moment(validEndTime).subtract(10, 'seconds').unix())
        expect(endTime).to.not.be.above(moment(validEndTime).add(10, 'seconds').unix())
      })

      it('should require timeToExtend to be less than maxSubscriptionLength', async () => {
        // set payment to an amount that would cause the extending of the subscription to be greater than maxSubscriptionLength
        const bigPayment = 5 * payment
        await expectRevert(tokenSubscription.extend(bigPayment, { from: subscriber}))
      })

      it('forwards funds correctly', async () => {
        await tokenSubscription.extend(payment, { from: subscriber })
        // expect balance in wallet to increase by payment
        expect(await botcoinBalanceOf(botCoin, walletAddress)).to.equal(payment)
      })
    })
  })

  describe('checkRegistration()', () => {
    let txResult
    
    beforeEach(async () => {
      await botCoin.transfer(subscriber, payment)
      await botCoin.approve(tokenSubscription.address, payment, { from: subscriber })
      await tokenSubscription.extend(payment, { from: subscriber })
    })

    describe('when checking whether a registered subscriber exists', () => {
      it('should return true', async () => {
        txResult = await tokenSubscription.checkRegistration.call(subscriber)
        expect(txResult).to.equal(true)
      })    
    })

    describe('when checking whether an unregistered subscriber exists', () => {
      it('should return false', async () => {
        txResult = await tokenSubscription.checkRegistration.call(nonSubscriber)
        expect(txResult).to.equal(false)
      })    
    })
  })

  describe('checkStatus()', () => {
    let txResult

    beforeEach(async () => {
      await botCoin.transfer(subscriber, payment)
      await botCoin.approve(tokenSubscription.address, payment, { from: subscriber })
      await tokenSubscription.extend(payment, { from: subscriber })
    })

    describe('when checking whether a subscribed user is paid', () => {
      it('should require that user is registered', async () => {
        await expectRevert(tokenSubscription.checkStatus.call(nonSubscriber))
      })
      
      it('should return true', async () => {
        txResult = await tokenSubscription.checkStatus.call(subscriber)
        expect(txResult).to.equal(true)
      })
    })

    describe('when checking whether a user with an expired subscription exists', () => {
      it('should return false', async () => {
        await increaseDays(10)
        txResult = await tokenSubscription.checkStatus.call(subscriber)
        expect(txResult).to.equal(false)
      })    
    })
  })

  describe('checkExpiration()', () => {
    let txResult

    beforeEach(async () => {
      await botCoin.transfer(subscriber, payment)
      await botCoin.approve(tokenSubscription.address, payment, { from: subscriber })
      await tokenSubscription.extend(payment, { from: subscriber })
    })
    
    describe('when checking a subsribed user expiration', () => {
      it('should require that user is registered', async () => {
        await expectRevert(tokenSubscription.checkExpiration.call(nonSubscriber))
      })

      it('should return the user expiration', async () => {
        txResult = (await tokenSubscription.checkExpiration.call(subscriber)).toNumber()
        const defaultTime = await defaultEndTime()
        expect(txResult).to.be.above(moment(defaultTime).subtract(10, 'seconds').unix())
        expect(txResult).to.not.be.above(moment(defaultTime).add(10, 'seconds').unix())
      })
    })
  })
})

async function botcoinBalanceOf (botCoin, address) {
  const bnBal = await botCoin.balanceOf(address)
  return bnBal.toNumber()
}

async function newTokenSubscription (_botCoinAddress) {
  const tokenSubscription = await tryAsync(TokenSubscription.new(_botCoinAddress, wallet, cost, duration, maxSubscriptionLength))
  return tokenSubscription
}

async function newBotCoin () {
  const bc = await tryAsync(BotCoin.new())
  return bc
}

let _latestTime // a moment() object

async function defaultEndTime () {
  if (!_latestTime) {
    _latestTime = await latestTime()
  }
  return moment(_latestTime).add(24 * 7, 'hours')
}

async function increaseDays (days) {
  const t = await increaseTestrpcTime(days * 60 * 60 * 24)
  return t
}

async function increaseTestrpcTime (duration) {
  await increaseTime(duration)
  _latestTime = await latestTime()
  return _latestTime
}