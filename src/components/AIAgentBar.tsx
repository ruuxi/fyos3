'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Bot, User, ChevronUp, ChevronDown, MessageCircle } from 'lucide-react';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'agent';
  timestamp: Date;
}

export default function AIAgentBar() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleSendMessage = () => {
    if (!input.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      content: input.trim(),
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, newMessage]);
    setInput('');

    // Simulate AI response (placeholder)
    setTimeout(() => {
      const aiResponse: Message = {
        id: (Date.now() + 1).toString(),
        content: "I'm an AI agent placeholder. I'm ready to help you with your development tasks!",
        sender: 'agent',
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, aiResponse]);
    }, 1000);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Collapsed state - floating button
  if (isCollapsed) {
    return (
      <div className="flex justify-center">
        <div className="bg-gray-600 hover:bg-gray-700 text-white rounded-full p-3 shadow-lg cursor-pointer transition-all duration-200 hover:scale-105">
          <Button
            onClick={() => setIsCollapsed(false)}
            variant="ghost"
            size="sm"
            className="p-0 h-auto text-white hover:text-white hover:bg-transparent"
          >
            <MessageCircle className="w-6 h-6" />
            {messages.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {messages.length}
              </span>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-4xl mx-4">
        <div className="bg-white/95 backdrop-blur-sm rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          {/* Header with collapse button */}
          <div className="flex items-center justify-between p-3 text-black">
            <div className="flex items-center space-x-2">
              <span className="font-medium text-sm">AI Assistant</span>
            </div>
            <div className="flex items-center space-x-1">
              <Button
                onClick={() => setIsCollapsed(true)}
                variant="ghost"
                size="sm"
                className="p-1 h-auto text-white hover:text-white bg-gray-400 hover:bg-gray-800"
              >
                <ChevronDown className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Chat History - Expandable */}
          {isExpanded && messages.length > 0 && (
            <div className="max-h-64 overflow-y-auto border-b border-gray-100 p-4">
              <div className="space-y-3">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex items-start space-x-3 ${
                      message.sender === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    {message.sender === 'agent' && (
                      <div className="flex-shrink-0 w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                        <Bot className="w-4 h-4 text-gray-600" />
                      </div>
                    )}
                    <div
                      className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                        message.sender === 'user'
                          ? 'bg-gray-600 text-white'
                          : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      <p className="text-sm">{message.content}</p>
                      <p className="text-xs mt-1 opacity-70">
                        {message.timestamp.toLocaleTimeString()}
                      </p>
                    </div>
                    {message.sender === 'user' && (
                      <div className="flex-shrink-0 w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                        <User className="w-4 h-4 text-gray-600" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Input Bar */}
          <div className="p-4">
            <div className="flex items-center space-x-3">
              {/* Message Input */}
              <div className="flex-1 flex items-end space-x-2">
                <div className="flex-1 relative">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Ask the AI agent anything about your project..."
                    className="min-h-[40px] max-h-32 resize-none pr-12"
                    rows={1}
                  />
                  <div className="absolute right-2 bottom-2 text-xs text-gray-400">
                    {input.length > 0 && `${input.length} chars`}
                  </div>
                </div>

                <Button
                  onClick={handleSendMessage}
                  disabled={!input.trim()}
                  size="sm"
                  className="h-10"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInput('Help me debug this issue')}
                className="text-xs"
              >
                Debug Help
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInput('Explain this code')}
                className="text-xs"
              >
                Explain Code
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInput('Suggest improvements')}
                className="text-xs"
              >
                Improve
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setInput('Generate tests')}
                className="text-xs"
              >
                Generate Tests
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
