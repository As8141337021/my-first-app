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
import { stockOptions } from './stockList.js'

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
  const [notification, setNotification] = useState('')
  const [isNewAccount, setIsNewAccount] = useState(false)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [confirmModal, setConfirmModal] = useState({ show: false, type: '', share: '', price: 0, quantity: 0 })

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

  const analysisData = useMemo(() => {
    const now = new Date()
    const monthKeys = []
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
      monthKeys.push(date.toISOString().slice(0, 7))
    }

    const monthlyPnL = monthKeys.reduce((acc, key) => ({ ...acc, [key]: 0 }), {})
    const monthlyVolume = monthKeys.reduce((acc, key) => ({ ...acc, [key]: 0 }), {})

    transactions.forEach(tx => {
      const month = tx.date?.slice(0, 7)
      if (!month || !monthlyPnL.hasOwnProperty(month)) return
      if (tx.type === 'sell') {
        monthlyPnL[month] += (tx.price - (tx.avgBuyPrice || 0)) * tx.quantity
      }
      monthlyVolume[month] += tx.price * tx.quantity
    })

    const values = monthKeys.map(key => monthlyPnL[key])
    const maxValue = Math.max(...values, 0)
    const minValue = Math.min(...values, 0)
    const range = maxValue - minValue || 1
    const points = values.map((value, index) => {
      const x = 40 + index * 80
      const y = 180 - ((value - minValue) / range) * 140
      return { x, y, value }
    })
    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

    const holdingSegments = Object.entries(holdings)
      .filter(([, data]) => data.quantity > 0)
      .map(([share, data]) => ({ share, value: Math.max(data.totalCost, 0) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
    const totalHoldingValue = holdingSegments.reduce((sum, item) => sum + item.value, 0)

    return {
      monthKeys,
      points,
      path,
      minValue,
      maxValue,
      monthlyVolume: monthKeys.map(key => monthlyVolume[key]),
      holdingSegments,
      totalHoldingValue
    }
  }, [transactions, holdings])

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
      avgBuyPrice: buys.length > 0 ? (buys.reduce((s, t) => s + (t.price * t.quantity), 0) / buys.reduce((s, t) => s + t.quantity, 0)) : 0,
      totalInvested: buys.reduce((s, t) => s + (t.price * t.quantity), 0)
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

  const showNotification = message => {
    setNotification(message)
    setTimeout(() => setNotification(''), 3600)
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
    if (!buyForm.share || !buyForm.buyPrice || !buyForm.buyQuantity) {
      setError('Please fill all required fields')
      return
    }
    setConfirmModal({
      show: true,
      type: 'buy',
      share: buyForm.share,
      price: parseFloat(buyForm.buyPrice),
      quantity: parseFloat(buyForm.buyQuantity)
    })
  }

  const confirmBuyTransaction = async () => {
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
      setConfirmModal({ show: false, type: '', share: '', price: 0, quantity: 0 })
      showNotification(`Buy trade confirmed: ${confirmModal.share} @ ₹${confirmModal.price} × ${confirmModal.quantity}`)
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

    if (!sellForm.share || !sellForm.sellPrice || !sellForm.sellQuantity) {
      setError('Please fill all required fields')
      return
    }

    setConfirmModal({
      show: true,
      type: 'sell',
      share: sellForm.share,
      price: parseFloat(sellForm.sellPrice),
      quantity: parseFloat(sellForm.sellQuantity)
    })
  }

  const confirmSellTransaction = async () => {
    const holding = holdings[sellForm.share]
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
      setConfirmModal({ show: false, type: '', share: '', price: 0, quantity: 0 })
      const pnl = (confirmModal.price - holding.avgPrice) * confirmModal.quantity
      showNotification(`Sell trade confirmed: ${confirmModal.share} @ ₹${confirmModal.price} | P/L: ₹${pnl.toFixed(2)}`)
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
          <h1>💹 TrackPort</h1>
          <p>Professional trading platform for portfolio management</p>
        </div>
      </header>

      {!user ? (
        <div className="auth-card">
          <h2>{isNewAccount ? 'Join TrackPort' : 'Welcome Back'}</h2>
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

          {notification && (
            <div className="notification-banner">
              {notification}
            </div>
          )}

          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Current Holdings</div>
              <div className="stat-value">{Object.keys(holdings).length} shares</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Total Invested</div>
              <div className="stat-value">₹{summary.totalInvested.toFixed(2)}</div>
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
            <button className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
              Dashboard 📊
            </button>
            <button className={`tab ${activeTab === 'trades' ? 'active' : ''}`} onClick={() => setActiveTab('trades')}>
              Trades 💼
            </button>
            <button className={`tab ${activeTab === 'holdings' ? 'active' : ''}`} onClick={() => setActiveTab('holdings')}>
              Holdings 📈
            </button>
            <button className={`tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
              History 📋
            </button>
          </div>

          {activeTab === 'dashboard' && (
            <>
              <div className="card premium">
                <h2>Trade Analytics</h2>
                <div className="charts-grid">
                  <div className="chart-card">
                    <h3>6-Month P/L Trend</h3>
                    <svg viewBox="0 0 560 220" className="chart-svg">
                      <path d={analysisData.path} fill="none" stroke="#60a5fa" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                      {analysisData.points.map(point => (
                        <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r="4" fill="#93c5fd" />
                      ))}
                      {analysisData.monthKeys.map((month, index) => (
                        <text key={month} x={40 + index * 80} y="210" textAnchor="middle" fill="#c7d2fe" fontSize="12">{month.slice(5)}</text>
                      ))}
                    </svg>
                  </div>
                  <div className="chart-card">
                    <h3>Portfolio Distribution</h3>
                    {analysisData.holdingSegments.length === 0 ? (
                      <p>No active holdings yet</p>
                    ) : (
                      <div className="legend">
                        {analysisData.holdingSegments.map((segment, index) => (
                          <div key={segment.share} className="legend-item">
                            <span className={`legend-bullet bullet-${index + 1}`} />
                            <span>{segment.share}</span>
                            <strong>₹{segment.value.toFixed(2)}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="card premium">
                <h2>Recent Transactions</h2>
                {transactions.length === 0 ? (
                  <p>No transactions yet</p>
                ) : (
                  <div className="transaction-list">
                    {transactions.slice(0, 10).map(tx => {
                      const totalAmount = (tx.price * tx.quantity).toFixed(2)
                      const pnl = tx.type === 'sell' ? ((tx.price - tx.avgBuyPrice) * tx.quantity).toFixed(2) : null
                      return (
                        <div key={tx.id} className={`tx-row ${tx.type}`}>
                          <div className="tx-icon">{tx.type === 'buy' ? '📥' : '📤'}</div>
                          <div className="tx-line">
                            <span className="tx-share">{tx.share}</span>
                            <span className="tx-date">{tx.date}</span>
                            <span className="tx-type">{tx.type.toUpperCase()}</span>
                            <span className="tx-price">₹{tx.price}</span>
                            <span className="tx-qty">×{tx.quantity}</span>
                            <span className="tx-total">= ₹{totalAmount}</span>
                            {tx.type === 'sell' && (
                              <span className={`tx-pnl-badge ${parseFloat(pnl) >= 0 ? 'gain' : 'loss'}`}>
                                {parseFloat(pnl) >= 0 ? '✓' : '✗'} ₹{Math.abs(parseFloat(pnl)).toFixed(2)}
                              </span>
                            )}
                          </div>
                          <button className="btn-delete" onClick={() => handleDeleteTx(tx.id)}>×</button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'trades' && (
            <div className="card premium">
              <h2>Record Transactions</h2>
              <div className="forms-container">
                <form onSubmit={handleBuy} className="form-grid">
                  <h3>Buy</h3>
                  <input type="date" value={buyForm.date} onChange={e => setBuyForm({...buyForm, date: e.target.value})} required />
                  <input list="stock-list" type="text" placeholder="Share name (e.g., INFY)" value={buyForm.share} onChange={e => setBuyForm({...buyForm, share: e.target.value})} required />
                  <input type="number" placeholder="Buying price" value={buyForm.buyPrice} onChange={e => setBuyForm({...buyForm, buyPrice: e.target.value})} step="0.01" required />
                  <input type="number" placeholder="Quantity" value={buyForm.buyQuantity} onChange={e => setBuyForm({...buyForm, buyQuantity: e.target.value})} step="1" required />
                  <textarea placeholder="Notes (optional)" value={buyForm.note} onChange={e => setBuyForm({...buyForm, note: e.target.value})} />
                  <button type="submit" className="btn-primary">Record Buy</button>
                </form>
                <form onSubmit={handleSell} className="form-grid">
                  <h3>Sell</h3>
                  <input type="date" value={sellForm.date} onChange={e => setSellForm({...sellForm, date: e.target.value})} required />
                  <input list="stock-list" type="text" placeholder="Share name" value={sellForm.share} onChange={e => setSellForm({...sellForm, share: e.target.value})} required />
                  <input type="number" placeholder="Selling price" value={sellForm.sellPrice} onChange={e => setSellForm({...sellForm, sellPrice: e.target.value})} step="0.01" required />
                  <input type="number" placeholder="Quantity to sell" value={sellForm.sellQuantity} onChange={e => setSellForm({...sellForm, sellQuantity: e.target.value})} step="1" required />
                  <textarea placeholder="Notes (optional)" value={sellForm.note} onChange={e => setSellForm({...sellForm, note: e.target.value})} />
                  <button type="submit" className="btn-primary">Record Sell</button>
                </form>
              </div>
              <datalist id="stock-list">
                {stockOptions.map(stock => (
                  <option key={stock} value={stock} />
                ))}
              </datalist>
              {error && <div className="error-box">{error}</div>}
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
                  {transactions.map(tx => {
                      const totalAmount = (tx.price * tx.quantity).toFixed(2)
                      const pnl = tx.type === 'sell' ? ((tx.price - tx.avgBuyPrice) * tx.quantity).toFixed(2) : null
                      return (
                        <div key={tx.id} className={`tx-row ${tx.type}`}>
                          <div className="tx-icon">{tx.type === 'buy' ? '📥' : '📤'}</div>
                          <div className="tx-line">
                            <span className="tx-share">{tx.share}</span>
                            <span className="tx-date">{tx.date}</span>
                            <span className="tx-type">{tx.type.toUpperCase()}</span>
                            <span className="tx-price">₹{tx.price}</span>
                            <span className="tx-qty">×{tx.quantity}</span>
                            <span className="tx-total">= ₹{totalAmount}</span>
                            {tx.type === 'sell' && (
                              <span className={`tx-pnl-badge ${parseFloat(pnl) >= 0 ? 'gain' : 'loss'}`}>
                                {parseFloat(pnl) >= 0 ? '✓' : '✗'} ₹{Math.abs(parseFloat(pnl)).toFixed(2)}
                              </span>
                            )}
                          </div>
                          <button className="btn-delete" onClick={() => handleDeleteTx(tx.id)}>×</button>
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {confirmModal.show && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Confirm {confirmModal.type === 'buy' ? 'Buy' : 'Sell'} Trade</h3>
            <div className="modal-details">
              <p><strong>Stock:</strong> {confirmModal.share}</p>
              <p><strong>Price:</strong> ₹{confirmModal.price}</p>
              <p><strong>Quantity:</strong> {confirmModal.quantity}</p>
              <p className="modal-total"><strong>Total Amount:</strong> ₹{(confirmModal.price * confirmModal.quantity).toFixed(2)}</p>
            </div>
            <div className="modal-buttons">
              <button className="btn-cancel" onClick={() => setConfirmModal({ show: false, type: '', share: '', price: 0, quantity: 0 })}>Cancel</button>
              <button className="btn-confirm" onClick={confirmModal.type === 'buy' ? confirmBuyTransaction : confirmSellTransaction}>
                Confirm {confirmModal.type === 'buy' ? 'Buy' : 'Sell'}
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="footer-premium">TrackPort © 2026 • Track. Analyze. Profit.</footer>
    </div>
  )
}

export default App
