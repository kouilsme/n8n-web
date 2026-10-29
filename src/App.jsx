import { useState, useCallback, useEffect } from 'react'
import config from './config'
import { setSessionUser, handleSessionStorage } from './session.js'
import { getCurrentUser, login, logout } from './authApi'
import { useTask } from './hooks/useTask'
import { useTaskManager } from './hooks/useTaskManager'
import AdminDashboard from './components/AdminDashboard'
import Header from './components/Header'
import LeftPanel from './components/LeftPanel'
import LoginPage from './components/LoginPage'
import RightPanel from './components/RightPanel'

function TaskInstance({
  platform,
  onPlatformChange,
  taskRecords,
  activeTaskId,
  initialTaskRecord,
  onDeleteTask,
  onClearTasks,
  onTaskSaved,
  onNewTask,
  onSelectTask,
}) {
  const task = useTask(onTaskSaved, initialTaskRecord)

  const handleSubmit = useCallback((formData) => {
    task.submit(platform, formData)
  }, [task, platform])

  const isFormLocked = task.taskStatus === 'submitting'

  return (
    <>
      <aside className="max-h-[45vh] w-full shrink-0 overflow-y-auto border-r border-gray-100 bg-white p-6 md:max-h-none md:w-[40%] lg:w-[38%] xl:w-[35%] dark:border-gray-800 dark:bg-gray-900">
        <LeftPanel
          platform={platform}
          onPlatformChange={onPlatformChange}
          onSubmit={handleSubmit}
          isSubmitting={isFormLocked}
          taskStatus={task.taskStatus}
          taskRecords={taskRecords}
          activeTaskId={activeTaskId}
          onDeleteTask={onDeleteTask}
          onClearTasks={onClearTasks}
          onNewTask={onNewTask}
          onSelectTask={onSelectTask}
        />
      </aside>

      <section className="min-h-0 min-w-0 flex-1 border-t border-gray-100 bg-gray-50 p-4 md:border-t-0 md:p-6 dark:border-gray-800 dark:bg-gray-900/50">
        <RightPanel
          platform={platform}
          taskStatus={task.taskStatus}
          stepName={task.stepName}
          statusMessage={task.statusMessage}
          preview={task.preview}
          history={task.history}
          previewHistory={task.previewHistory}
          allowRevise={task.allowRevise}
          allowConfirm={task.allowConfirm}
          errorMessage={task.errorMessage}
          isActionSubmitting={task.isActionSubmitting}
          xhsImages={task.xhsImages}
          currentXhsImageIndex={task.currentXhsImageIndex}
          frames={task.frames}
          currentFrameIndex={task.currentFrameIndex}
          videoUrl={task.videoUrl}
          workflowMode={task.workflowMode}
          storyboardDocument={task.storyboardDocument}
          downloadUrl={task.downloadUrl}
          fileList={task.fileList}
          generationProgress={task.generationProgress}
          onRevise={task.revise}
          onConfirm={task.confirm}
          onPreviewTextChange={task.updatePreviewText}
          onRetry={task.reset}
          onStopTask={task.stopTask}
          onApproveXhsImage={task.approveXhsImage}
          onRejectXhsImage={task.rejectXhsImage}
          onRegenImages={task.regenImages}
          onApproveFrame={task.approveFrame}
          onRejectFrame={task.rejectFrame}
          onGenerateVideo={task.triggerGenerateVideo}
          onRegenVideo={task.regenVideo}
          onConfirmVideo={task.confirmVideo}
        />
      </section>
    </>
  )
}

function WorkspaceApp({ user, isDark, onToggleDark, onLogout }) {
  const [view, setView] = useState('app')
  const [platform, setPlatform] = useState('xiaohongshu')

  const {
    taskRecords,
    activeTaskKey,
    selectedTaskRecord,
    refreshTaskRecords,
    newTask,
    selectTask,
    deleteTaskRecord,
    clearTaskRecords,
  } = useTaskManager()

  const activeTaskId = selectedTaskRecord?.taskId || null

  const handleSelectTask = useCallback((taskId) => {
    selectTask(taskId)
  }, [selectTask])

  return (
    <div className="flex h-full flex-col bg-gray-50 dark:bg-gray-900">
      <Header
        isDark={isDark}
        onToggleDark={onToggleDark}
        user={user}
        view={view}
        onShowApp={() => setView('app')}
        onShowAdmin={() => setView('admin')}
        onLogout={onLogout}
      />

      {view === 'admin' && user.role === 'ADMIN' ? (
        <AdminDashboard />
      ) : (
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          <TaskInstance
            key={activeTaskKey}
            platform={selectedTaskRecord?.platform || platform}
            onPlatformChange={setPlatform}
            taskRecords={taskRecords}
            activeTaskId={activeTaskId}
            initialTaskRecord={selectedTaskRecord}
            onDeleteTask={deleteTaskRecord}
            onClearTasks={clearTaskRecords}
            onTaskSaved={refreshTaskRecords}
            onNewTask={newTask}
            onSelectTask={handleSelectTask}
          />
        </main>
      )}
    </div>
  )
}

export default function App() {
  const [isDark, setIsDark] = useState(() => {
    try {
      const saved = localStorage.getItem(`${config.STORAGE_PREFIX}dark`)
      if (saved !== null) return saved === 'true'
    } catch {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [user, setUser] = useState(null)
  const [isAuthLoading, setIsAuthLoading] = useState(true)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
    try {
      localStorage.setItem(`${config.STORAGE_PREFIX}dark`, String(isDark))
    } catch {}
  }, [isDark])

  useEffect(() => {
    let alive = true
    getCurrentUser()
      .then((result) => {
        if (alive) {
          setSessionUser(result.user.id)
          setUser(result.user)
        }
      })
      .catch(() => {
        if (alive) {
          setSessionUser(null)
          setUser(null)
        }
      })
      .finally(() => {
        if (alive) setIsAuthLoading(false)
      })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const handleStorage = (event) => {
      if (handleSessionStorage(event)) setUser(null)
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const handleLogin = async (email, password) => {
    const result = await login(email, password)
    setSessionUser(result.user.id)
    setUser(result.user)
  }

  const handleLogout = async () => {
    try {
      await logout()
    } finally {
      setSessionUser(null)
      setUser(null)
    }
  }

  if (isAuthLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50 text-sm text-gray-500 dark:bg-gray-900 dark:text-gray-400">
        正在检查登录状态...
      </div>
    )
  }

  if (!user) {
    return (
      <LoginPage
        onLogin={handleLogin}
        isDark={isDark}
        onToggleDark={() => setIsDark((d) => !d)}
      />
    )
  }

  return (
    <WorkspaceApp
      key={user.id}
      user={user}
      isDark={isDark}
      onToggleDark={() => setIsDark((d) => !d)}
      onLogout={handleLogout}
    />
  )
}

