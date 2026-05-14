import { useEffect, useMemo, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc
} from 'firebase/firestore'
import { auth, db } from './firebase.js'

const emptyBuyForm = {
  date: new Date().toISOString().slice(0, 10),
  share: '',
  buyPrice: '',
  buyQuantity: '',
  note: ''
}

const emptySellForm = {
  date: new Date().toISOString().slice(0, 10),
  share: '',
  sellPrice: '',
  sellQuantity: '',
  note: ''
}

function App() {
  const [user, setUser] = useState(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [transactions, setTransactions] = useState([])
  const [buyForm, setBuyForm] = useState(emptyBuyForm)
  const [sellForm, setSellForm] = useState(emptySellForm)
  const [error, setError] = useState('')
  const [isNewAccount, setIsNewAccount] = useState(false)
  const [activeTab, setActiveTab] = useState('buy')

  useEffect(() => {
    return onAuthStateChanged(auth, currentUser => {
      setUser(currentUser)
      setError('')
    })
  }, [])

  useEffect(() => {
    if (!user) {
      setTransactions([])
      return
    }

    const txRef = collection(db, 'users', user.uid, 'transactions')
    const txQuery = query(txRef, orderBy('date', 'desc'))
    return onSnapshot(txQuery, snapshot => {
      setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
    })
  }, [user])

  const holdings = useMemo(() => {
    const shares = {}
    transactions.forEach(tx => {
      if (!shares[tx.share]) {
        shares[tx.share] = { quantity: 0, totalCost: 0, avgPrice: 0 }
      }
      if (tx.type === 'buy') {
        shares[tx.share].totalCost += tx.price * tx.quantity
        shares[tx.share].quantity += tx.quantity
        shares[tx.share].avgPrice = shares[tx.share].totalCost / shares[tx.share].quantity
      } else {
        shares[tx.share].quantity -= tx.quantity
        shares[tx.share].totalCost -= tx.price * tx.quantity
      }
    })
    return shares
  }, [transactions])

  const profitLoss = useMemo(() => {
    let totalPnL = 0
    transactions.forEach(tx => {
      if (tx.type === 'sell') {
        const buyPrice = tx.avgBuyPrice || 0
        const pnl = (tx.price - buyPrice) * tx.quantity
        totalPnL += pnl
      }
    })
    return totalPnL
  }, [transactions])

  const summary = useMemo(() => {
    const buys = transactions.filter(t => t.type === 'buy')
    const sells = transactions.filter(t => t.type === 'sell')
    const currentMonth = new Date().toISOString().slice(0, 7)
    const monthSells = sells.filter(t => t.date.startsWith(currentMonth))
    const monthPnL = monthSells.reduce((sum, t) => sum + ((t.price - (t.avgBuyPrice || 0)) * t.quantity), 0)
    
    return {
      totalBuys: buys.length,
      totalSells: sells.length,
      currentMonthSells: monthSells.length,
      currentMonthPnL: monthPnL,
      avgBuyPrice: buys.length > 0 ? (buys.reduce((s, t) => s + (t.price * t.quantity), 0) / buys.reduce((s, t) => s + t.quantity, 0)) : 0
    }
  }, [transactions])

  const exportCsv = () => {
    const headers = ['Date', 'Type', 'Share', 'Price', 'Quantity', 'Amount', 'Profit/Loss', 'Note']
    const rows = transactions.map(tx => [
      tx.date,
      tx.type.toUpperCase(),
      tx.share,
      tx.price,
      tx.quantity,
      (tx.price * tx.quantity).toFixed(2),
      tx.type === 'sell' ? ((tx.price - (tx.avgBuyPrice || 0)) * tx.quantity).toFixed(2) : '—',
      tx.note || ''
    ])
    const csvContent = [headers, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `trades-${user.email}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleAuth = async event => {
    event.preventDefault()
    setError('')
    try {
      if (isNewAccount) {
        await createUserWithEmailAndPassword(auth, email, password)
      } else {
        await signInWithEmailAndPassword(auth, email, password)
      }
      setEmail('')
      setPassword('')
    } catch (err) {
      setError(err.message)
    }
  }

  const handleBuy = async event => {
    event.preventDefault()
    if (!user) return

    try {
      await addDoc(collection(db, 'users', user.uid, 'transactions'), {
        type: 'buy',
        share: buyForm.share,
        price: parseFloat(buyForm.buyPrice),
        quantity: parseFloat(buyForm.buyQuantity),
        date: buyForm.date,
        note: buyForm.note,
        timestamp: new Date()
      })
      setBuyForm({ ...emptyBuyForm, date: new Date().toISOString().slice(0, 10) })
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  const handleSell = async event => {
    event.preventDefault()
    if (!user) return

    const holding = holdings[sellForm.share]
    if (!holding || holding.quantity < parseFloat(sellForm.sellQuantity)) {
      setError(`Insufficient quantity. Available: ${holding?.quantity || 0}`)
      return
    }

    try {
      await addDoc(collection(db, 'users', user.uid, 'transactions'), {
        type: 'sell',
        share: sellForm.share,
        price: parseFloat(sellForm.sellPrice),
        quantity: parseFloat(sellForm.sellQuantity),
        avgBuyPrice: holding.avgPrice,
        date: sellForm.date,
        note: sellForm.note,
        timestamp: new Date()
      })
      setSellForm({ ...emptySellForm, date: new Date().toISOString().slice(0, 10) })
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  const handleDeleteTx = async id => {
    if (!user) return
    if (!window.confirm('Delete this transaction?')) return
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'transactions', id))
    } catch (err) {
      setError(err.message)
    }
  }

  const handleSignOut = async () => {
    await signOut(auth)
    setBuyForm(emptyBuyForm)
    setSellForm(emptySellForm)
  }

  return (
    <div className="app-shell">
      <header className="header-premium">
        <div className="header-content">
          <h1>💹 StockVault</h1>
          <p>Professional trade tracking and portfolio analytics</p>
        </div>
      </header>

      {!user ? (
        <div className="auth-card">
          <h2>{isNewAccount ? 'Join StockVault' : 'Welcome Back'}</h2>
          <form onSubmit={handleAuth} className="auth-form">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Email address"
              required
            />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              required
              minLength={6}
            />
            {error && <div className="error-box">{error}</div>}
            <button type="submit" className="btn-primary">{isNewAccount ? 'Create Account' : 'Sign In'}</button>
            <button type="button" className="btn-secondary" onClick={() => setIsNewAccount(!isNewAccount)}>
              {isNewAccount ? 'Already have an account?' : 'Create a new account'}
            </button>
          </form>
        </div>
      ) : (
        <>
          <div className="user-bar">
            <div>👤 {user.email}</div>
            <button className="btn-secondary" onClick={handleSignOut}>Sign Out</button>
          </div>

          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Current Holdings</div>
              <div className="stat-value">{Object.keys(holdings).length} shares</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Profit/Loss</div>
              <div className={`stat-value ${profitLoss >= 0 ? 'positive' : 'negative'}`}>
                {profitLoss >= 0 ? '📈' : '📉'} ₹{Math.abs(profitLoss).toFixed(2)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Sell Transactions</div>
              <div className="stat-value">{summary.totalSells}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">This Month P/L</div>
              <div className={`stat-value ${summary.currentMonthPnL >= 0 ? 'positive' : 'negative'}`}>
                ₹{summary.currentMonthPnL >= 0 ? '+' : ''}{summary.currentMonthPnL.toFixed(2)}
              </div>
            </div>
          </div>

          <div className="tabs">
            <button className={`tab ${activeTab === 'buy' ? 'active' : ''}`} onClick={() => setActiveTab('buy')}>
              Buy 📥
            </button>
            <button className={`tab ${activeTab === 'sell' ? 'active' : ''}`} onClick={() => setActiveTab('sell')}>
              Sell 📤
            </button>
            <button className={`tab ${activeTab === 'holdings' ? 'active' : ''}`} onClick={() => setActiveTab('holdings')}>
              Holdings 📊
            </button>
            <button className={`tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
              History 📋
            </button>
          </div>

          {activeTab === 'buy' && (
            <div className="card premium">
              <h2>Record Buy Transaction</h2>
              <form onSubmit={handleBuy} className="form-grid">
                <input type="date" value={buyForm.date} onChange={e => setBuyForm({...buyForm, date: e.target.value})} required />
                <input type="text" placeholder="Share name (e.g., INFY)" value={buyForm.share} onChange={e => setBuyForm({...buyForm, share: e.target.value})} required />
                <input type="number" placeholder="Buying price" value={buyForm.buyPrice} onChange={e => setBuyForm({...buyForm, buyPrice: e.target.value})} step="0.01" required />
                <input type="number" placeholder="Quantity" value={buyForm.buyQuantity} onChange={e => setBuyForm({...buyForm, buyQuantity: e.target.value})} step="1" required />
                <textarea placeholder="Notes (optional)" value={buyForm.note} onChange={e => setBuyForm({...buyForm, note: e.target.value})} />
                {error && <div className="error-box">{error}</div>}
                <button type="submit" className="btn-primary">Record Buy</button>
              </form>
            </div>
          )}

          {activeTab === 'sell' && (
            <div className="card premium">
              <h2>Record Sell Transaction (Partial Sells Supported)</h2>
              <form onSubmit={handleSell} className="form-grid">
                <input type="date" value={sellForm.date} onChange={e => setSellForm({...sellForm, date: e.target.value})} required />
                <input type="text" placeholder="Share name" value={sellForm.share} onChange={e => setSellForm({...sellForm, share: e.target.value})} required />
                <input type="number" placeholder="Selling price" value={sellForm.sellPrice} onChange={e => setSellForm({...sellForm, sellPrice: e.target.value})} step="0.01" required />
                <input type="number" placeholder="Quantity to sell" value={sellForm.sellQuantity} onChange={e => setSellForm({...sellForm, sellQuantity: e.target.value})} step="1" required />
                <textarea placeholder="Notes (optional)" value={sellForm.note} onChange={e => setSellForm({...sellForm, note: e.target.value})} />
                {error && <div className="error-box">{error}</div>}
                <button type="submit" className="btn-primary">Record Sell</button>
              </form>
            </div>
          )}

          {activeTab === 'holdings' && (
            <div className="card premium">
              <h2>Current Holdings</h2>
              {Object.keys(holdings).length === 0 ? (
                <p>No active holdings</p>
              ) : (
                <div className="holdings-grid">
                  {Object.entries(holdings).map(([share, data]) => data.quantity > 0 && (
                    <div key={share} className="holding-card">
                      <div className="holding-name">{share}</div>
                      <div className="holding-qty">Qty: {data.quantity}</div>
                      <div className="holding-price">Avg: ₹{data.avgPrice.toFixed(2)}</div>
                      <div className="holding-total">Total: ₹{data.totalCost.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div className="card premium">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2>Transaction History</h2>
                <button className="btn-secondary" onClick={exportCsv}>Export CSV</button>
              </div>
              {transactions.length === 0 ? (
                <p>No transactions yet</p>
              ) : (
                <div className="transaction-list">
                  {transactions.map(tx => (
                    <div key={tx.id} className={`tx-row ${tx.type}`}>
                      <div className="tx-icon">{tx.type === 'buy' ? '📥' : '📤'}</div>
                      <div className="tx-info">
                        <div className="tx-share">{tx.share}</div>
                        <div className="tx-meta">{tx.date} • ₹{tx.price} × {tx.quantity}</div>
                      </div>
                      <div className="tx-amount">
                        ₹{(tx.price * tx.quantity).toFixed(2)}
                      </div>
                      {tx.type === 'sell' && (
                        <div className={`tx-pnl ${(tx.price - tx.avgBuyPrice) >= 0 ? 'gain' : 'loss'}`}>
                          {(tx.price - tx.avgBuyPrice) >= 0 ? '✓' : '✗'} ₹{Math.abs((tx.price - tx.avgBuyPrice) * tx.quantity).toFixed(2)}
                        </div>
                      )}
                      <button className="btn-delete" onClick={() => handleDeleteTx(tx.id)}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <footer className="footer-premium">StockVault © 2026 • Track. Analyze. Profit.</footer>
    </div>
  )
}

export default App
