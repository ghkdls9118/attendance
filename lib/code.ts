import { createHmac, randomInt } from 'crypto'
export const hashCode = (c: string) => createHmac('sha256', process.env.CODE_PEPPER!).update(c).digest('hex')
export const randomCode = () => String(randomInt(0, 10000)).padStart(4, '0')
