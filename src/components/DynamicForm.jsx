import { useState, useEffect, useCallback } from 'react'
import { userStorageKey } from '../session.js'

function createEmptyValues(schema) {
  return schema.reduce((acc, field) => {
    acc[field.name] = field.type === 'file' ? [] : (field.defaultValue || '')
    return acc
  }, {})
}

function serializeFormData(schema, formData) {
  return schema.reduce((acc, field) => {
    acc[field.name] = field.type === 'file' ? [] : (formData[field.name] ?? field.defaultValue ?? '')
    return acc
  }, {})
}

function hasValue(field, value) {
  if (field.type === 'file') {
    return Array.isArray(value) && value.length > 0
  }

  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  return value !== null && value !== undefined && value !== ''
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size <= 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export default function DynamicForm({ schema, platform, onSubmit, isSubmitting }) {
  const storageKey = userStorageKey(`form_${platform}`)

  const getInitialValues = useCallback(() => {
    const baseValues = createEmptyValues(schema)

    try {
      const saved = localStorage.getItem(storageKey)
      if (!saved) return baseValues

      const parsed = JSON.parse(saved)
      return schema.reduce((acc, field) => {
        acc[field.name] = field.type === 'file'
          ? []
          : (parsed[field.name] ?? baseValues[field.name])
        return acc
      }, { ...baseValues })
    } catch {
      return baseValues
    }
  }, [schema, storageKey])

  const [formData, setFormData] = useState(getInitialValues)
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})

  useEffect(() => {
    setFormData(getInitialValues())
    setErrors({})
    setTouched({})
  }, [platform, getInitialValues])

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(serializeFormData(schema, formData)))
    } catch {}
  }, [formData, schema, storageKey])

  const clearError = useCallback((name) => {
    setErrors((prev) => {
      if (!prev[name]) return prev
      const next = { ...prev }
      delete next[name]
      return next
    })
  }, [])

  const handleChange = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }))
    clearError(name)
  }

  const handleFileChange = (field, event) => {
    const maxFiles = field.maxFiles || 3
    const maxFileSizeBytes = field.maxFileSizeBytes || (3 * 1024 * 1024)
    const acceptedTypes = (field.accept || 'image/*').split(',').map((item) => item.trim()).filter(Boolean)
    const files = Array.from(event.target.files || [])
    event.target.value = ''

    if (files.length > maxFiles) {
      setTouched((prev) => ({ ...prev, [field.name]: true }))
      setErrors((prev) => ({ ...prev, [field.name]: `最多上传 ${maxFiles} 张图片` }))
      return
    }

    const invalidFile = files.find((file) => {
      const typeMatches = acceptedTypes.some((type) => type === 'image/*' || file.type === type)
      return !typeMatches || file.size > maxFileSizeBytes
    })

    if (invalidFile) {
      const message = invalidFile.size > maxFileSizeBytes
        ? `单张图片不能超过 ${formatFileSize(maxFileSizeBytes)}`
        : '仅支持 PNG、JPG、WEBP 图片'
      setTouched((prev) => ({ ...prev, [field.name]: true }))
      setErrors((prev) => ({ ...prev, [field.name]: message }))
      return
    }

    handleChange(field.name, files)
    setTouched((prev) => ({ ...prev, [field.name]: true }))
  }

  const handleRemoveFile = (fieldName, index) => {
    setFormData((prev) => ({
      ...prev,
      [fieldName]: (prev[fieldName] || []).filter((_, fileIndex) => fileIndex !== index),
    }))
  }

  const handleBlur = (name) => {
    setTouched((prev) => ({ ...prev, [name]: true }))
    const field = schema.find((item) => item.name === name)
    if (field?.required && !hasValue(field, formData[name])) {
      setErrors((prev) => ({ ...prev, [name]: `请填写 ${field.label}` }))
    }
  }

  const validate = () => {
    const nextErrors = {}
    const nextTouched = {}

    schema.forEach((field) => {
      nextTouched[field.name] = true
      if (field.required && !hasValue(field, formData[field.name])) {
        nextErrors[field.name] = `请填写 ${field.label}`
      }
    })

    setTouched(nextTouched)
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!validate()) return
    onSubmit(formData)
  }

  const handleReset = () => {
    setFormData(createEmptyValues(schema))
    setErrors({})
    setTouched({})
    try {
      localStorage.removeItem(storageKey)
    } catch {}
  }

  const renderFileField = (field, baseInputClass, hasError) => {
    const files = Array.isArray(formData[field.name]) ? formData[field.name] : []
    const maxFiles = field.maxFiles || 3
    const maxFileSizeBytes = field.maxFileSizeBytes || (3 * 1024 * 1024)

    return (
      <div className="space-y-3">
        <label className={`${baseInputClass} flex cursor-pointer flex-col items-center justify-center gap-2 border-dashed text-center`}>
          <input
            type="file"
            accept={field.accept || 'image/*'}
            multiple={maxFiles > 1}
            className="hidden"
            onChange={(event) => handleFileChange(field, event)}
            onBlur={() => handleBlur(field.name)}
            disabled={isSubmitting}
          />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
            点击上传参考图片
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            支持 PNG / JPG / WEBP，最多 {maxFiles} 张，单张不超过 {formatFileSize(maxFileSizeBytes)}
          </span>
        </label>

        {field.helperText && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{field.helperText}</p>
        )}

        {files.length > 0 && (
          <div className="space-y-2">
            {files.map((file, index) => (
              <div
                key={`${field.name}_${file.name}_${index}`}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${hasError
                  ? 'border-red-200 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10'
                  : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60'
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-700 dark:text-gray-100">{file.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(field.name, index)}
                  disabled={isSubmitting}
                  className="ml-3 shrink-0 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 transition hover:border-gray-300 hover:text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-500 dark:hover:text-gray-100"
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const renderField = (field) => {
    const hasError = touched[field.name] && errors[field.name]
    const baseInputClass = `w-full rounded-xl border bg-white px-4 py-3 text-sm transition-all duration-200
      placeholder:text-gray-400
      focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500
      dark:bg-gray-800 dark:border-gray-600 dark:text-gray-100 dark:placeholder:text-gray-500
      dark:focus:ring-primary-400/30 dark:focus:border-primary-400
      ${hasError
        ? 'border-red-400 dark:border-red-500'
        : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
      }`

    switch (field.type) {
      case 'textarea':
        return (
          <textarea
            value={formData[field.name] || ''}
            onChange={(event) => handleChange(field.name, event.target.value)}
            onBlur={() => handleBlur(field.name)}
            placeholder={field.placeholder}
            rows={3}
            className={`${baseInputClass} resize-none`}
            disabled={isSubmitting}
          />
        )

      case 'select':
        return (
          <select
            value={formData[field.name] || ''}
            onChange={(event) => handleChange(field.name, event.target.value)}
            onBlur={() => handleBlur(field.name)}
            className={`${baseInputClass} appearance-none cursor-pointer bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%239ca3af%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22M6%209l6%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-10`}
            disabled={isSubmitting}
          >
            <option value="">{field.placeholder}</option>
            {field.options?.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        )

      case 'number':
        return (
          <input
            type="number"
            value={formData[field.name] || ''}
            onChange={(event) => handleChange(field.name, event.target.value)}
            onBlur={() => handleBlur(field.name)}
            placeholder={field.placeholder}
            min={field.min}
            max={field.max}
            className={baseInputClass}
            disabled={isSubmitting}
          />
        )

      case 'file':
        return renderFileField(field, baseInputClass, hasError)

      default:
        return (
          <input
            type="text"
            value={formData[field.name] || ''}
            onChange={(event) => handleChange(field.name, event.target.value)}
            onBlur={() => handleBlur(field.name)}
            placeholder={field.placeholder}
            className={baseInputClass}
            disabled={isSubmitting}
          />
        )
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {schema.map((field) => (
        <div key={field.name} className="animate-fade-in">
          <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
            {field.label}
            {field.required && (
              <span className="text-xs text-red-500">*</span>
            )}
          </label>
          {renderField(field)}
          {touched[field.name] && errors[field.name] && (
            <p className="mt-1 animate-fade-in text-xs text-red-500">
              {errors[field.name]}
            </p>
          )}
        </div>
      ))}

      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex-1 rounded-xl bg-primary-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-primary-600/25 transition-all duration-200 hover:bg-primary-700 hover:shadow-primary-700/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary-600 dark:bg-primary-500 dark:shadow-primary-500/20 dark:hover:bg-primary-600"
        >
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              提交中...
            </span>
          ) : (
            '开始生成'
          )}
        </button>

        <button
          type="button"
          onClick={handleReset}
          disabled={isSubmitting}
          className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-600 transition-all duration-200 hover:border-gray-300 hover:bg-gray-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:bg-gray-700"
        >
          重置
        </button>
      </div>
    </form>
  )
}
