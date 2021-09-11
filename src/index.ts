import { CRC } from 'crc-full'
import { Merge } from 'type-fest'

type BluetoothGATTDevice = Merge<BluetoothDevice, { gatt: BluetoothRemoteGATTServer }>

/**
 * BLE GATT helper class.
 * @param device - The BLE device to connect.
 * @param service - Bluetooth service UUID.
 * @param characteristic - GATT characteristic UUID.
 * @returns A socket-like class for BLE communication.
 */
class BluetoothGATTSocket {
  public readonly device: BluetoothGATTDevice
  public readonly service: BluetoothServiceUUID
  public readonly characteristic: BluetoothCharacteristicUUID

  constructor (device: BluetoothDevice, service: BluetoothServiceUUID, characteristic: BluetoothCharacteristicUUID) {
    if (device.gatt === undefined) {
      throw new Error('GATT is null! Is this the right device?')
    } else {
      this.device = device as BluetoothGATTDevice
      this.service = service
      this.characteristic = characteristic
    }
  }

  async connect (): Promise<BluetoothRemoteGATTCharacteristic> {
    const gatt = await this.device.gatt.connect()
    return await (await gatt.getPrimaryService(this.service))
      .getCharacteristic(this.characteristic)
  }

  async close (): Promise<void> {
    return this.device.gatt.disconnect()
  }
}

/**
 * Control interface for Changgong BLE hydrovalve.
 *
 * @param device - The hydrovalve.
 * @returns Hydrovalve control interface.
 */
export class BLEWaterDevice {
  private readonly socket: BluetoothGATTSocket
  private readonly channel: Promise<BluetoothRemoteGATTCharacteristic>
  public started = false

  constructor (device: BluetoothDevice) {
    const socket = new BluetoothGATTSocket(device, 0xF1_F0, 0xF1_F1) // Target characteristic name = TXD, uuid = 0xF1F1
    if (socket.device.name === undefined) {
      throw new Error('Device name is null! Is this a valid device?')
    } else {
      this.socket = socket
      this.channel = socket.connect()
    }
  }

  async start (): Promise<void> {
    const channel = await this.channel

    // credits to @celesWuff for `CRC16_CHANGGONG`
    const crc16cg = new CRC('CRC16_CHANGGONG', 16, 0x80_05, 0xE8_08, 0x00_00, true, true)

    function string2ab (string_: string): Uint8Array {
      const array = new Uint8Array(string_.length)
      for (let index = 0; index < string_.length; index++) {
        array[index] = string_.charCodeAt(index)
      }
      return array
    }

    const checksum = new Uint8Array(
      (
        crc16cg.compute([...string2ab(
          (this.socket.device as Merge<BluetoothGATTDevice, { name: string }> /* make typescript happy cause' type guards doesn't work in this case */)
            .name
            .slice(-5)
        )])
          .toString(16)
          .match(/.{1,2}/g) ?? []
      )
        .map(byte => Number.parseInt(byte, 16))
    ) // convert number to TypedArray

    const payload = await channel.writeValue(
      new Uint8Array([
        0xFE,
        0xFE,
        0x09,
        0xB2,
        0x01,
        // dirty hack as we don't want to import bloat here
        checksum[1],
        checksum[0],
        0x00,
        0x70,
        0xE2,
        0xEB,
        0x20,
        0x01,
        0x01,
        0x00,
        0x00,
        0x00,
        0x6C,
        0x30,
        0x00
      ]))
    this.started = true
    return payload
  }

  async stop (): Promise<void> {
    if (this.started) {
      return await (await this.channel).writeValue(new Uint8Array([0xFE, 0xFE, 0x09, 0xB3, 0x00, 0x00]))
    }
  }

  async close (): Promise<void> {
    return await this.socket.close()
  }
}
