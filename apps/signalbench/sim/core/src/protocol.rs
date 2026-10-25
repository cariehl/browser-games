//! Wire protocol shared with `firmware/sdk/include/sim_protocol.h`.
//!
//! Every message: `u8 type | u16 len (LE) | payload`. Little-endian ints.

use std::io::{self, Read, Write};

pub const DEFAULT_PORT: u16 = 47800;
pub const MAGIC: u32 = 0x4843_4253; // "SBCH"
pub const PROTO_VERSION: u16 = 1;

// firmware -> simulator
pub const MSG_HELLO: u8 = 0x10;
pub const MSG_CAN_TX: u8 = 0x11;
pub const MSG_UART_TX: u8 = 0x12;
pub const MSG_I2C_XFER: u8 = 0x13;
pub const MSG_WDT: u8 = 0x14;
pub const MSG_SYS_RESET: u8 = 0x15;
pub const MSG_TICK_DONE: u8 = 0x1F;

// simulator -> firmware
pub const MSG_WELCOME: u8 = 0x81;
pub const MSG_TICK: u8 = 0x82;
pub const MSG_I2C_RESULT: u8 = 0x83;
pub const MSG_RESET: u8 = 0x84;

pub const EXIT_CODE_RESET: i32 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize)]
pub struct CanFrame {
    pub id: u32,
    pub dlc: u8,
    pub data: [u8; 8],
}

impl CanFrame {
    pub fn new(id: u32, data: &[u8]) -> Self {
        let mut d = [0u8; 8];
        let n = data.len().min(8);
        d[..n].copy_from_slice(&data[..n]);
        CanFrame { id, dlc: n as u8, data: d }
    }
    pub fn payload(&self) -> &[u8] {
        &self.data[..self.dlc.min(8) as usize]
    }
}

/// Inputs presented to the MCU at the start of a tick.
#[derive(Debug, Clone, Default)]
pub struct TickInputs {
    pub now_ms: u32,
    pub gpio_in: u32,
    pub adc: [u16; 4],
    pub encoder: i32,
    pub can_rx: Vec<CanFrame>,
    pub uart_rx: Vec<u8>,
}

/// Output latches reported by the MCU at the end of a tick.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
pub struct McuOutputs {
    pub gpio_out: u32,
    pub pwm: [(u32, u16); 4],
}

#[derive(Debug, Clone)]
pub enum FwMsg {
    Hello { version: u16, name: String },
    CanTx(CanFrame),
    UartTx(Vec<u8>),
    I2cXfer { addr: u8, tx: Vec<u8>, rx_len: u8 },
    Wdt { op: u8, timeout_ms: u32 },
    SysReset,
    TickDone(McuOutputs),
    Unknown(u8),
}

fn u16le(b: &[u8]) -> u16 {
    u16::from_le_bytes([b[0], b[1]])
}
fn u32le(b: &[u8]) -> u32 {
    u32::from_le_bytes([b[0], b[1], b[2], b[3]])
}

pub fn decode(kind: u8, p: &[u8]) -> io::Result<FwMsg> {
    let short = || io::Error::new(io::ErrorKind::InvalidData, format!("short message 0x{kind:02X}"));
    Ok(match kind {
        MSG_HELLO => {
            if p.len() < 7 || u32le(p) != MAGIC {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "bad HELLO magic"));
            }
            let n = p[6] as usize;
            let name = String::from_utf8_lossy(p.get(7..7 + n).unwrap_or(&[])).into_owned();
            FwMsg::Hello { version: u16le(&p[4..]), name }
        }
        MSG_CAN_TX => {
            if p.len() < 13 {
                return Err(short());
            }
            let mut data = [0u8; 8];
            data.copy_from_slice(&p[5..13]);
            FwMsg::CanTx(CanFrame { id: u32le(p) & 0x7FF, dlc: p[4].min(8), data })
        }
        MSG_UART_TX => FwMsg::UartTx(p.to_vec()),
        MSG_I2C_XFER => {
            if p.len() < 3 {
                return Err(short());
            }
            let txn = p[1] as usize;
            FwMsg::I2cXfer { addr: p[0], tx: p.get(3..3 + txn).unwrap_or(&[]).to_vec(), rx_len: p[2] }
        }
        MSG_WDT => {
            if p.len() < 5 {
                return Err(short());
            }
            FwMsg::Wdt { op: p[0], timeout_ms: u32le(&p[1..]) }
        }
        MSG_SYS_RESET => FwMsg::SysReset,
        MSG_TICK_DONE => {
            if p.len() < 28 {
                return Err(short());
            }
            let mut o = McuOutputs { gpio_out: u32le(p), ..Default::default() };
            for i in 0..4 {
                let b = &p[4 + i * 6..];
                o.pwm[i] = (u32le(b), u16le(&b[4..]).min(1000));
            }
            FwMsg::TickDone(o)
        }
        other => FwMsg::Unknown(other),
    })
}

pub fn write_msg<W: Write>(w: &mut W, kind: u8, payload: &[u8]) -> io::Result<()> {
    let mut buf = Vec::with_capacity(3 + payload.len());
    buf.push(kind);
    buf.extend_from_slice(&(payload.len() as u16).to_le_bytes());
    buf.extend_from_slice(payload);
    w.write_all(&buf)
}

pub fn encode_tick(t: &TickInputs) -> Vec<u8> {
    let mut p = Vec::with_capacity(32 + t.can_rx.len() * 13 + t.uart_rx.len());
    p.extend_from_slice(&t.now_ms.to_le_bytes());
    p.extend_from_slice(&t.gpio_in.to_le_bytes());
    for a in t.adc {
        p.extend_from_slice(&a.to_le_bytes());
    }
    p.extend_from_slice(&t.encoder.to_le_bytes());
    let n = t.can_rx.len().min(255);
    p.push(n as u8);
    for f in &t.can_rx[..n] {
        p.extend_from_slice(&f.id.to_le_bytes());
        p.push(f.dlc);
        p.extend_from_slice(&f.data);
    }
    let u = t.uart_rx.len().min(1024);
    p.extend_from_slice(&(u as u16).to_le_bytes());
    p.extend_from_slice(&t.uart_rx[..u]);
    p
}

/// Incremental frame reader over a (possibly non-blocking) stream.
#[derive(Default)]
pub struct FrameReader {
    buf: Vec<u8>,
}

impl FrameReader {
    /// Pull whatever bytes are available (WouldBlock/TimedOut are not errors).
    /// Returns Ok(false) when the peer closed the connection.
    pub fn fill<R: Read>(&mut self, r: &mut R) -> io::Result<bool> {
        let mut tmp = [0u8; 8192];
        match r.read(&mut tmp) {
            Ok(0) => Ok(false),
            Ok(n) => {
                self.buf.extend_from_slice(&tmp[..n]);
                Ok(true)
            }
            Err(e) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => Ok(true),
            Err(e) if e.kind() == io::ErrorKind::Interrupted => Ok(true),
            Err(e) => Err(e),
        }
    }

    /// Pop one complete message if buffered.
    pub fn next(&mut self) -> Option<(u8, Vec<u8>)> {
        if self.buf.len() < 3 {
            return None;
        }
        let len = u16le(&self.buf[1..]) as usize;
        if self.buf.len() < 3 + len {
            return None;
        }
        let kind = self.buf[0];
        let payload = self.buf[3..3 + len].to_vec();
        self.buf.drain(..3 + len);
        Some((kind, payload))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tick_done_roundtrip() {
        let mut p = vec![];
        p.extend_from_slice(&0x8001_0000u32.to_le_bytes());
        for i in 0..4u32 {
            p.extend_from_slice(&(1000 * i).to_le_bytes());
            p.extend_from_slice(&(250u16 * i as u16).to_le_bytes());
        }
        match decode(MSG_TICK_DONE, &p).unwrap() {
            FwMsg::TickDone(o) => {
                assert_eq!(o.gpio_out, 0x8001_0000);
                assert_eq!(o.pwm[2], (2000, 500));
            }
            _ => panic!(),
        }
    }

    #[test]
    fn frame_reader_handles_partial_input() {
        let mut out = vec![];
        write_msg(&mut out, MSG_UART_TX, b"hello").unwrap();
        write_msg(&mut out, MSG_SYS_RESET, &[]).unwrap();
        let mut fr = FrameReader::default();
        let (a, b) = out.split_at(4);
        fr.fill(&mut &a[..]).unwrap();
        assert!(fr.next().is_none());
        fr.fill(&mut &b[..]).unwrap();
        assert_eq!(fr.next().unwrap(), (MSG_UART_TX, b"hello".to_vec()));
        assert_eq!(fr.next().unwrap().0, MSG_SYS_RESET);
    }
}
