/*
  This file is part of web3x.

  web3x is free software: you can redistribute it and/or modify
  it under the terms of the GNU Lesser General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  web3x is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Lesser General Public License for more details.

  You should have received a copy of the GNU Lesser General Public License
  along with web3x.  If not, see <http://www.gnu.org/licenses/>.
*/

import { isBoolean } from 'util';
import { AbiDefinition } from '.';
import { Address } from '../address';
import { BlockType, Eth, SendTxPromiEvent } from '../eth';
import { TransactionReceipt } from '../formatters';
import { promiEvent } from '../promievent';
import { fireError } from '../utils';
import { Wallet } from '../wallet';
import { abi } from './abi';

export type TxFactory = (...args: any[]) => Tx;

export interface CallOptions {
  from?: Address;
  gasPrice?: string | number;
  gas?: number;
}

export interface SendOptions {
  from?: Address;
  gasPrice?: string | number;
  gas?: number;
  value?: number | string;
}

interface EstimateOptions {
  from?: Address;
  gas?: string | number;
  gasPrice?: string | number;
  value?: number | string;
}

type DefaultOptions = {
  from?: Address;
  gasPrice?: string | number;
  gas?: number;
};

export interface TxCall<Return = any> {
  call(options?: CallOptions, block?: BlockType): Promise<Return>;
  getCallRequestPayload(options?: CallOptions, block?: number);
  estimateGas(options?: EstimateOptions): Promise<number>;
  encodeABI(): string;
}

export interface TxSend<TxReceipt = TransactionReceipt> {
  send(options?: SendOptions): SendTxPromiEvent<TxReceipt>;
  getSendRequestPayload(options?: SendOptions);
  estimateGas(options?: EstimateOptions): Promise<number>;
  encodeABI(): string;
}

/**
 * returns the an object with call, send, estimate functions
 *
 * @method _createTxObject
 * @returns {Object} an object with functions to call the methods
 */
export class Tx implements TxCall, TxSend {
  constructor(
    private eth: Eth,
    private definition: AbiDefinition,
    private contractAddress: Address,
    private args: any[] = [],
    private defaultOptions: DefaultOptions = {},
    private wallet?: Wallet,
    private extraFormatters?: any,
  ) {
    if (this.definition.type !== 'function') {
      throw new Error('Tx should only be used with functions.');
    }
  }

  public async estimateGas(options: EstimateOptions = {}) {
    return await this.eth.estimateGas(this.getTx(options));
  }

  public async call(options: CallOptions = {}, block?: BlockType) {
    const result = await this.eth.call(this.getTx(options), block);
    return this.decodeMethodReturn(this.definition.outputs, result);
  }

  public getCallRequestPayload(options: CallOptions, block?: number) {
    const result = this.eth.request.call(this.getTx(options), block);
    return {
      ...result,
      format: result => this.decodeMethodReturn(this.definition.outputs, result),
    };
  }

  public send(options: SendOptions): SendTxPromiEvent {
    const tx = this.getTx(options);

    // return error, if no "from" is specified
    if (!tx.from) {
      const defer = promiEvent();
      return fireError(
        new Error('No "from" address specified in neither the given options, nor the default options.'),
        defer.eventEmitter,
        defer.reject,
      );
    }

    if (isBoolean(this.definition.payable) && !this.definition.payable && tx.value && tx.value > 0) {
      const defer = promiEvent();
      return fireError(
        new Error('Can not send value to non-payable contract method or constructor'),
        defer.eventEmitter,
        defer.reject,
      );
    }

    const account = this.getAccount(tx.from);

    if (account) {
      return account.sendTransaction(tx, this.eth, this.extraFormatters);
    } else {
      return this.eth.sendTransaction(tx, this.extraFormatters);
    }
  }

  public getSendRequestPayload(options: SendOptions) {
    return this.eth.request.sendTransaction(this.getTx(options));
  }

  public encodeABI() {
    const methodSignature = this.definition.signature;
    const paramsABI = abi.encodeParameters(this.definition.inputs || [], this.args).replace('0x', '');
    return methodSignature + paramsABI;
  }

  private getAccount(address?: Address) {
    address = address || this.defaultOptions.from;
    if (this.wallet && address) {
      return this.wallet.get(address.toString());
    }
  }

  private getTx(options: any = {}): any {
    return {
      to: this.contractAddress,
      from: options.from || this.defaultOptions.from,
      gasPrice: options.gasPrice || this.defaultOptions.gasPrice,
      gas: options.gas || this.defaultOptions.gas,
      value: options.value,
      data: this.encodeABI(),
    };
  }

  private decodeMethodReturn(outputs, returnValues) {
    if (!returnValues) {
      return null;
    }

    returnValues = returnValues.length >= 2 ? returnValues.slice(2) : returnValues;
    const result = abi.decodeParameters(outputs, returnValues);

    if (result.__length__ === 1) {
      return result[0];
    } else {
      delete result.__length__;
      return result;
    }
  }
}
